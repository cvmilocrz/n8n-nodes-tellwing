'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Tellwing } = require('../dist/nodes/Tellwing/Tellwing.node.js')
const { executeContext, KEY } = require('./helpers')

const node = new Tellwing()

test('crear o actualizar suscriptor: POST a la lista con consent_source, sin campos vacíos y con Idempotency-Key', async () => {
  const { ctx, calls } = executeContext({
    params: {
      resource: 'subscriber', listId: 12, email: 'ana@example.com', consentSource: 'checkout',
      additionalFields: { firstName: 'Ana', lastName: '', tags: 'cliente, vip', attributes: '{"ciudad":"Bogotá"}', consentText: 'Acepto el boletín' },
    },
    responder: () => ({ id: 's1', email: 'ana@example.com' }),
  })
  const [out] = await node.execute.call(ctx)
  assert.deepEqual(out[0].json, { id: 's1', email: 'ana@example.com' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].credentialType, 'tellwingApi')
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].url, 'https://api.tellwing.com/v1/lists/12/subscribers')
  assert.deepEqual(calls[0].body, {
    email: 'ana@example.com', consent_source: 'checkout', name: 'Ana', consent_text: 'Acepto el boletín',
    tags: ['cliente', 'vip'], attributes: { ciudad: 'Bogotá' },
  })
  assert.match(calls[0].headers['Idempotency-Key'], /^[0-9a-f-]{36}$/)
  // La key nunca va en el cuerpo ni en la URL: la pone la credencial.
  assert.ok(!JSON.stringify(calls[0]).includes(KEY))
})

test('enviar mensaje con plantilla: destinatarios como arreglo y variables', async () => {
  const { ctx, calls } = executeContext({
    params: { resource: 'message', to: 'a@example.com, b@example.com', content: 'template', templateId: 'tpl-1', variables: '{"code":"482913"}', subject: '', messageFields: {} },
    responder: () => ({ id: 'm1', status: 'sent', recipients: 2, suppressed: [], delivery_id: 'd1' }),
  })
  await node.execute.call(ctx)
  assert.equal(calls[0].url, 'https://api.tellwing.com/v1/messages')
  assert.deepEqual(calls[0].body, { to: ['a@example.com', 'b@example.com'], template_id: 'tpl-1', variables: { code: '482913' } })
})

test('enviar mensaje propio sin HTML ni texto falla antes de llamar a la API', async () => {
  const { ctx, calls } = executeContext({
    params: { resource: 'message', to: 'a@example.com', content: 'inline', subject: 'Hola', html: '', text: '', messageFields: {} },
    responder: () => ({}),
  })
  await assert.rejects(() => node.execute.call(ctx), /HTML or the text/)
  assert.equal(calls.length, 0)
})

test('registrar evento: POST /v1/events con el id propio y los datos', async () => {
  const { ctx, calls } = executeContext({
    params: { resource: 'event', eventName: 'order_paid', identifyBy: 'email', eventEmail: 'ana@example.com', eventFields: { eventId: 'order-10234', data: '{"order_id":"10234"}' } },
    responder: () => ({ id: 'e1', event: 'order_paid', status: 'accepted', subscriber_id: 's1', automations: 1 }),
  })
  const [out] = await node.execute.call(ctx)
  assert.equal(out[0].json.status, 'accepted')
  assert.equal(calls[0].url, 'https://api.tellwing.com/v1/events')
  assert.deepEqual(calls[0].body, { event: 'order_paid', email: 'ana@example.com', id: 'order-10234', data: { order_id: '10234' } })
})

test('un error de la API llega con su mensaje y su campo; con «continuar si falla», como un ítem', async () => {
  const apiError = () => {
    const err = new Error('Request failed with status code 422')
    err.response = { body: { error: { code: 'consent_required', message: 'consent_source is required to add a subscriber.', param: 'consent_source' } } }
    throw err
  }
  const params = { resource: 'subscriber', listId: 12, email: 'ana@example.com', consentSource: 'checkout', additionalFields: {} }
  const failing = executeContext({ params, responder: apiError })
  await assert.rejects(() => node.execute.call(failing.ctx), /consent_source is required to add a subscriber\. \(field: consent_source\)/)
  const tolerant = executeContext({ params, responder: apiError, continueOnFail: true })
  const [out] = await node.execute.call(tolerant.ctx)
  assert.equal(out[0].json.error, 'consent_source is required to add a subscriber. (field: consent_source)')
})

test('los desplegables leen listas y plantillas de la API', async () => {
  const { ctx, calls } = executeContext({
    params: {},
    responder: (options) =>
      options.url.endsWith('/lists') ? { data: [{ id: 12, name: 'Newsletter' }], next_cursor: null } : { data: [{ id: 't1', name: 'Bienvenida' }], next_cursor: null },
  })
  assert.deepEqual(await node.methods.loadOptions.getLists.call(ctx), [{ name: 'Newsletter', value: 12 }])
  assert.deepEqual(await node.methods.loadOptions.getTemplates.call(ctx), [{ name: 'Bienvenida', value: 't1' }])
  assert.deepEqual(calls.map((c) => [c.method, c.url, c.qs]), [
    ['GET', 'https://api.tellwing.com/v1/lists', { limit: 100 }],
    ['GET', 'https://api.tellwing.com/v1/templates', { limit: 100 }],
  ])
})
