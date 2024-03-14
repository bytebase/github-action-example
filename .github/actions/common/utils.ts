import * as path from 'path';

export interface Change {
    // Specify an id so that we can update the change afterwards.
    id: string;
    database: string;
    file: string;
    content: string;
    // Extract from the filename. If filename is 123_init.sql, then the version is 123.
    schemaVersion: string;
}

// Use a deterministic way to generate the change id and schema version.
// Thus later we can derive the same id when we want to check the change.
export function generateChangeIdAndSchemaVersion(repo: string, pr: string, file: string) : { id: string; version: string} {
    // filename should follow yyy/<<version>>_xxxx
   const version = path.basename(file).split("_")[0]
   // Replace all non-alphanumeric characters with hyphens
   return { id: `ch-${repo}-pr${pr}-${version}`.replace(/[^a-zA-Z0-9]/g, '-'), version};
}
 