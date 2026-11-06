import type { AITurn } from "./assistant";
export async function consumeAssistantStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (s: string) => void,
): Promise<{ conversation_id: string; turn: AITurn }> {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  let result: { conversation_id: string; turn: AITurn } | undefined;
  let size = 0;
  function event(raw: string) {
    let kind = "",
      data = "";
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) kind = line.slice(6).trim();
      if (line.startsWith("data:")) data += line.slice(5).trimStart() + "\n";
    }
    if (!data) return;
    const v = JSON.parse(data);
    if (kind === "delta") onDelta(String(v.text || ""));
    if (kind === "done") result = v;
    if (kind === "error") throw Error(v.error || "Stream failed");
  }
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 2 * 1024 * 1024) throw Error("Response too large");
      buffer = (buffer + decoder.decode(chunk.value, { stream: true })).replace(
        /\r\n/g,
        "\n",
      );
      let pos;
      while ((pos = buffer.indexOf("\n\n")) >= 0) {
        event(buffer.slice(0, pos));
        buffer = buffer.slice(pos + 2);
      }
      if (result) {
        await reader.cancel();
        return result;
      }
    }
    if (!result) throw Error("模型流已中断，请重试同一请求");
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
