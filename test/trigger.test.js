'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { TellwingTrigger } = require('../dist/nodes/TellwingTrigger/TellwingTrigger.node.js')
const { verifySignature } = require('../dist/nodes/shared/GenericFunctions.js')
const { hookContext, webhookContext, sign } = require('./helpers')

const trigger = new TellwingTrigger()
const hooks = trigger.webhookMethods.default
const SECRET = ['whsec', 'secreto-de-prueba-inventado'].join('_')
const URL = 'https://n8n.example.com/webhook/abc/webhook'

test('crear: POST /v1/webhooks con la URL de n8n y los eventos; guarda id y secret en los datos estáticos', async () => {
  const { ctx, calls, staticData } = hookContext({
    events: ['subscriber.created', 'email.bounced'],
    responder: () => ({ id: 'w1', url: URL, events: ['subscriber.created', 'email.bounced'], mode: 'test', status: 'active', description: 'n8n', created_at: '2026-10-31T15:00:00.000Z', secret: SECRET }),
  })
  assert.equal(await hooks.create.call(ctx), true)
  assert.deepEqual(calls[0].body, { url: URL, events: ['subscriber.created', 'email.bounced'], description: 'n8n' })
  assert.equal(calls[0].url, 'https://api.tellwing.com/v1/webhooks')
  assert.deepEqual(staticData, { webhookId: 'w1', webhookSecret: SECRET })
})

test('comprobar: existe si el endpoint sigue con la misma URL y eventos; si cambiaron, se borra y se recrea', async () => {
  const listing = { data: [{ id: 'w1', url: URL, events: ['email.bounced', 'subscriber.created'], mode: 'live', status: 'active', description: 'n8n', created_at: '2026-10-31T15:00:00.000Z' }], next_cursor: null }
  const same = hookContext({ events: ['subscriber.created', 'email.bounced'], staticData: { webhookId: 'w1', webhookSecret: SECRET }, responder: () => listing })
  assert.equal(await hooks.checkExists.call(same.ctx), true)

  const changed = hookContext({ events: ['subscriber.created'], staticData: { webhookId: 'w1', webhookSecret: SECRET }, responder: (o) => (o.method === 'GET' ? listing : undefined) })
  assert.equal(await hooks.checkExists.call(changed.ctx), false)
  assert.deepEqual(changed.calls.map((c) => c.method), ['GET', 'DELETE'])
  assert.deepEqual(changed.staticData, {})

  const none = hookContext({ events: ['subscriber.created'], responder: () => assert.fail('sin id no hay que llamar a la API') })
  assert.equal(await hooks.checkExists.call(none.ctx), false)
})

test('borrar: DELETE /v1/webhooks/{id}, tolera que ya no exista, y limpia los datos estáticos', async () => {
  const { ctx, calls, staticData } = hookContext({ events: [], staticData: { webhookId: 'w1', webhookSecret: SECRET }, responder: () => undefined })
  assert.equal(await hooks.delete.call(ctx), true)
  assert.equal(calls[0].method, 'DELETE')
  assert.equal(calls[0].url, 'https://api.tellwing.com/v1/webhooks/w1')
  assert.equal(calls[0].ignoreHttpStatusErrors, true)
  assert.deepEqual(staticData, {})
})

test('una entrega bien firmada arranca el flujo con el sobre tal cual', async () => {
  const event = { id: 'e1', type: 'subscriber.created', created_at: '2026-10-31T15:00:00.000Z', livemode: false, data: { subscriber: { id: 's1', email: 'ana@example.com' } } }
  const raw = JSON.stringify(event)
  const { ctx } = webhookContext({ events: ['subscriber.created'], secret: SECRET, rawBody: raw, signature: sign(SECRET, raw) })
  const result = await trigger.webhook.call(ctx)
  assert.deepEqual(result, { workflowData: [[{ json: event }]] })
})

test('firma de otro secret, sin firma o cuerpo cambiado: 401 y el flujo no arranca', async () => {
  const raw = JSON.stringify({ id: 'e1', type: 'subscriber.created', livemode: true, data: {} })
  for (const signature of [sign('whsec_otro', raw), undefined, sign(SECRET, raw.replace('e1', 'e2'))]) {
    const { ctx, response } = webhookContext({ events: ['subscriber.created'], secret: SECRET, rawBody: raw, signature })
    assert.deepEqual(await trigger.webhook.call(ctx), { noWebhookResponse: true })
    assert.equal(response.statusCode, 401)
  }
})

test('el ping de «Enviar prueba» y los eventos no elegidos no arrancan el flujo', async () => {
  const raw = JSON.stringify({ id: 'p', type: 'ping', livemode: true, data: {} })
  const { ctx } = webhookContext({ events: ['subscriber.created'], secret: SECRET, rawBody: raw, signature: sign(SECRET, raw) })
  assert.deepEqual(await trigger.webhook.call(ctx), { webhookResponse: { received: true } })
})

test('la firma caduca a los 300 s', () => {
  const raw = '{"a":1}'
  const t = 1_793_000_000
  assert.equal(verifySignature(SECRET, raw, sign(SECRET, raw, t), t + 300), true)
  assert.equal(verifySignature(SECRET, raw, sign(SECRET, raw, t), t + 301), false)
})
