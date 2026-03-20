import fs from 'node:fs';
import { getStaticResourceByUri, staticResources, type StaticResourceDefinition } from './staticResources';

export interface ResourceLookupResult extends StaticResourceDefinition {
  content: string;
}

export function listStaticResources(): StaticResourceDefinition[] {
  return [...staticResources];
}

export function lookupStaticResource(uri: string): ResourceLookupResult {
  const resource = getStaticResourceByUri(uri);
  if (!resource) {
    throw new Error(`Unknown repo split resource: ${uri}`);
  }

  return {
    ...resource,
    content: fs.readFileSync(resource.filePath, 'utf-8'),
  };
}
