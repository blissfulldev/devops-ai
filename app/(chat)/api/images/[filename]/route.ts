import type { NextRequest } from 'next/server';
import { join } from 'node:path';
import { statSync, readFileSync } from 'node:fs';

export async function GET(
  req: NextRequest,
  context: { params: { filename: string } },
) {
  const { filename } = await context.params; // <-- await here
  const imagePath = join(
    process.cwd(),
    'workspace/generated-diagrams',
    filename,
  );

  try {
    statSync(imagePath);
    const imageBuffer = readFileSync(imagePath);
    return new Response(new Uint8Array(imageBuffer), {
      headers: { 'Content-Type': 'image/png' },
    });
  } catch (err) {
    return new Response('Image not found', { status: 404 });
  }
}
