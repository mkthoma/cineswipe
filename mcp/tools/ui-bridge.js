const sseClients = new Set();

export function addSSEClient(res) {
  sseClients.add(res);
}

export function removeSSEClient(res) {
  sseClients.delete(res);
}

export function sendSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}
