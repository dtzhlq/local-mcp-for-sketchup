export async function freshSessionOptions(bridge, { runtime = 'mock', timeoutMs, expiresInMs } = {}) {
  if (runtime !== 'queue') return {};
  const created = await bridge.create_queue_handshake({ timeoutMs, expires_in_ms: expiresInMs });
  return { session_contract: created.session_contract };
}
