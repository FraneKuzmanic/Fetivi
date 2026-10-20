import { type McpServerName, SCOPES } from '@fetivi/domain';
import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/server';

/**
 * The RFC 9728 document of one server. No `authorization_servers` (optional in RFC 9728): guest
 * tokens come from the chat backend, which is no OAuth authorization server.
 */
export function protectedResourceMetadata(resource: string, server: McpServerName) {
  return {
    resource,
    resource_name: `Fetivi ${server}`,
    scopes_supported: [...SCOPES[server]],
    bearer_methods_supported: ['header'],
  };
}

/** The document's path: `/.well-known/oauth-protected-resource` ahead of the resource path. */
export function metadataPath(resource: string): string {
  return new URL(getOAuthProtectedResourceMetadataUrl(new URL(resource))).pathname;
}
