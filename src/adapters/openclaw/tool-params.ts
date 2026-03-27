export function normalizeToolParams(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
  const params = { ...input };

  if (toolName === "shell") {
    const command = coerceString(params["command"] ?? params["cmd"] ?? params["input"] ?? params["text"]);
    return { ...params, command };
  }

  if (toolName === "file_write") {
    const path = coerceString(params["path"] ?? params["file"] ?? params["target"]);
    const content = coerceString(params["content"] ?? params["text"] ?? params["body"]);
    return { ...params, path, content };
  }

  if (toolName === "web_fetch") {
    const url = coerceString(params["url"] ?? params["link"] ?? params["target"]);
    return { ...params, url };
  }

  return params;
}

function coerceString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}
