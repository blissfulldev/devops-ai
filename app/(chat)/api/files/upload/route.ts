import { Storage } from '@google-cloud/storage';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/app/(auth)/auth';

// Use Blob instead of File since File is not available in Node.js environment
const FileSchema = z.object({
  file: z
    .instanceof(Blob)
    .refine((file) => file.size <= 5 * 1024 * 1024, {
      message: 'File size should be less than 5MB',
    })
    // Update the file type based on the kind of files you want to accept
    .refine((file) => ['image/jpeg', 'image/png'].includes(file.type), {
      message: 'File type should be JPEG or PNG',
    }),
});

export async function POST(request: Request) {
  const session = await auth();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (request.body === null) {
    return new Response('Request body is empty', { status: 400 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as Blob;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const validatedFile = FileSchema.safeParse({ file });

    if (!validatedFile.success) {
      const errorMessage = validatedFile.error.errors
        .map((error) => error.message)
        .join(', ');

      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    // Get filename from formData since Blob doesn't have name property
    const filename = (formData.get('file') as File).name;
    const fileBuffer = await file.arrayBuffer();
    // Upload to Google Cloud Storage
    try {
      const bucketName = process.env.GCS_BUCKET;

      if (!bucketName) {
        return NextResponse.json(
          { error: 'Server misconfiguration: GCS_BUCKET is not set' },
          { status: 500 },
        );
      }

      // Build Storage client from env vars
      const keyJson = process.env.GCP_SERVICE_ACCOUNT_KEY
        ? JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY)
        : null;

      const clientEmail = process.env.GCP_CLIENT_EMAIL || keyJson?.client_email;
      const privateKeyRaw = process.env.GCP_PRIVATE_KEY || keyJson?.private_key;
      const projectId = process.env.GCP_PROJECT_ID || keyJson?.project_id;

      if (!clientEmail || !privateKeyRaw) {
        return NextResponse.json(
          { error: 'Server misconfiguration: GCP credentials are not set' },
          { status: 500 },
        );
      }

      const credentials = {
        client_email: clientEmail,
        private_key: privateKeyRaw.replace(/\\n/g, '\n'),
      };

      const storage = new Storage({
        projectId,
        credentials,
      });

      const bucket = storage.bucket(bucketName);
      const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const objectName = `uploads/${session.user?.id || 'anonymous'}/${Date.now()}-${safeFilename}`;
      const fileRef = bucket.file(objectName);

      await fileRef.save(Buffer.from(fileBuffer), {
        resumable: false,
        contentType: file.type,
        metadata: {
          contentType: file.type,
          cacheControl: 'public, max-age=31536000, immutable',
        },
      });

      // Determine a URL to return
      let url: string | undefined;

      // Prefer a configured public base URL if provided (e.g., Cloud CDN or https://storage.googleapis.com/<bucket>)
      const publicBase = process.env.GCS_PUBLIC_BASE_URL;
      if (publicBase) {
        // Ensure no duplicate slashes
        const base = publicBase.replace(/\/$/, '');
        // Encode each path segment
        const encodedPath = objectName
          .split('/')
          .map(encodeURIComponent)
          .join('/');
        url = `${base}/${encodedPath}`;
      } else {
        // Fallback to a signed URL (V4) for read access
        const sevenDays = 7 * 24 * 60 * 60 * 1000;
        const [signedUrl] = await fileRef.getSignedUrl({
          version: 'v4',
          action: 'read',
          expires: Date.now() + sevenDays,
        });
        url = signedUrl;
      }

      return NextResponse.json({
        url,
        pathname: objectName,
        contentType: file.type,
      });
    } catch (error) {
      console.error('GCS upload failed:', error);
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 },
    );
  }
}
