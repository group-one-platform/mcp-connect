/**
 * What a "client" is to this CLI: something detectable on the machine, whose MCP
 * registration we can read, write and remove.
 *
 * There is no auth mode here, and that absence is the design. The platform's MCP
 * endpoint answers an unauthenticated request with
 * `WWW-Authenticate: Bearer resource_metadata="…"`; that metadata names the brand's own
 * panel as the authorization server; and the panel offers open Dynamic Client
 * Registration with PKCE. A compliant client therefore needs the URL and nothing else.
 *
 * So a registration this CLI writes never contains a credential. There is no token flag
 * to misuse, no long-lived bearer to paste, no secret to leak into a dotfile and no file
 * mode to get wrong — and ending access stays a thing the customer does in the chat
 * settings panel ("Connected apps"), not something they must first remember they pasted.
 */

export interface Registration {
  /** the key the server is stored under — the brand id, e.g. `uniweb` */
  key: string;
  /** the streamable-HTTP MCP endpoint */
  url: string;
}

export interface McpClient {
  /** stable id, e.g. `cursor` */
  id: string;
  /** display name, e.g. `Cursor` */
  name: string;
  /** whether the client appears to be installed on this machine */
  detect(): Promise<boolean>;
  /** whether THIS brand is currently registered with this client */
  isRegistered(reg: Registration): Promise<boolean>;
  register(reg: Registration): Promise<void>;
  unregister(reg: Registration): Promise<void>;
  /** where the registration lives (config path or command), for display */
  describeTarget(): string;
}

export interface ClientStatus {
  client: McpClient;
  installed: boolean;
  registered: boolean;
}
