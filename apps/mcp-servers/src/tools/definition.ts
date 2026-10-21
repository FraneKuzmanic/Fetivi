import type { Tool } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { type GuestToolSpec, guestToolMeta } from '../servers/tool';

// The SDK's conversion target for listed schemas.
const TARGET = 'draft-2020-12';

function jsonSchema(schema: z.ZodObject, io: 'input' | 'output'): Record<string, unknown> {
  const json = schema['~standard'].jsonSchema[io]({ target: TARGET }) as Record<string, unknown>;
  // As the SDK: an input root is always an object; every output schema here is a z.object.
  return io === 'input' ? { type: 'object', ...json } : json;
}

/**
 * A spec's `Tool` exactly as the MCP server lists it in `tools/list`: absent keys stay absent,
 * as they would vanish on the JSON wire.
 */
export function toolDefinition(spec: GuestToolSpec): Tool {
  const { config } = spec;
  const meta = guestToolMeta(spec);
  return {
    name: spec.name,
    ...(config.title === undefined ? {} : { title: config.title }),
    description: config.description,
    inputSchema: jsonSchema(config.inputSchema, 'input') as Tool['inputSchema'],
    annotations: config.annotations,
    ...(meta ? { _meta: meta } : {}),
    outputSchema: jsonSchema(config.outputSchema, 'output') as Tool['outputSchema'],
  };
}
