import { tool } from 'ai';
import { z } from 'zod';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';

export const writeTerraformToDisk = () =>
  tool({
    description: `Parses an XML-like string containing a Terraform project structure and writes the files to a dedicated 'workspace/terraform_project_latest' directory.
This tool will overwrite any existing files in that directory. Use this tool to create or update a Terraform project.`,
    inputSchema: z.object({
      project_files_xml: z
        .string()
        .describe(
          'A string containing the entire project structure, with each file enclosed in <file path="...">...</file> tags.',
        ),
    }),
    execute: async ({ project_files_xml }) => {
      try {
        // Parse XML-like file blocks using regex
        const fileBlockRegex = /<file path="(.+?)">(.*?)<\/file>/gs;
        const blocks: [string, string][] = [];

        // Use matchAll instead of while loop with assignment
        const matches = project_files_xml.matchAll(fileBlockRegex);
        for (const match of matches) {
          blocks.push([match[1], match[2]]);
        }

        if (blocks.length === 0) {
          return 'No valid file blocks found.';
        }

        // Create output directory
        const outDir = join(
          process.cwd(),
          'workspace',
          'terraform_project_latest',
        );
        await mkdir(outDir, { recursive: true });

        // Write each file
        for (const [path, content] of blocks) {
          const filePath = join(outDir, path);
          const fileDir = dirname(filePath);

          // Ensure directory exists
          await mkdir(fileDir, { recursive: true });

          // Write file content (trimmed)
          await writeFile(filePath, content.trim(), 'utf-8');
        }

        const absolutePath = resolve(outDir);
        return `Saved ${blocks.length} files to ${absolutePath}`;
      } catch (error) {
        return `Error writing files to disk: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    },
  });
