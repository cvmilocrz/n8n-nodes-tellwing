'use strict'

/**
 * Contextos de n8n simulados: `this` de execute, loadOptions, los métodos del
 * webhook y el webhook mismo. `httpRequestWithAuthentication` NUNCA sale a la
 * red: devuelve lo que diga cada prueba y apunta cada petición en `calls`.
 */
const { createHmac } = require('node:crypto')

const KEY = 'tw_test_ejemploInventadoParaPruebas00000000000000'
const NODE = { id: 'n1', name: 'Tellwing', type: 'n8n-nodes-tellwing.tellwing', typeVersion: 1, position: [0, 0], parameters: {} }

function http(responder) {
  const calls = []
  const fn = async function (credentialType, options) {
    calls.push({ credentialType, ...options })
    return responder(options, calls.length - 1)
  }
  return { fn, calls }
}

function executeContext({ params, items = [{ json: {} }], responder, continueOnFail = false }) {
  const { fn, calls } = http(responder)
  const ctx = {
    getInputData: () => items,
    getNodeParameter: (name, i, fallback) => {
      const value = typeof params === 'function' ? params(i)[name] : params[name]
      return value === undefined ? fallback : value
    },
    getCredentials: async () => ({ apiKey: KEY, baseUrl: 'https://api.tellwing.com/v1' }),
    getNode: () => NODE,
    continueOnFail: () => continueOnFail,
    helpers: { httpRequestWithAuthentication: fn },
  }
  return { ctx, calls }
}

function hookContext({ events, url = 'https://n8n.example.com/webhook/abc/webhook', staticData = {}, responder }) {
  const { fn, calls } = http(responder)
  const ctx = {
    getWorkflowStaticData: () => staticData,
    getNodeWebhookUrl: () => url,
    getNodeParameter: (name) => (name === 'events' ? events : undefined),
    getCredentials: async () => ({ apiKey: KEY, baseUrl: 'https://api.tellwing.com/v1' }),
    getNode: () => NODE,
    helpers: { httpRequestWithAuthentication: fn },
  }
  return { ctx, calls, staticData }
}

function webhookContext({ events, secret, rawBody, signature }) {
  const response = { statusCode: 200, body: null }
  const ctx = {
    getRequestObject: () => ({ rawBody: Buffer.from(rawBody, 'utf8'), body: JSON.parse(rawBody) }),
    getHeaderData: () => (signature === undefined ? {} : { 'tellwing-signature': signature }),
    getWorkflowStaticData: () => ({ webhookId: 'w1', webhookSecret: secret }),
    getNodeParameter: (name) => (name === 'events' ? events : undefined),
    getResponseObject: () => ({
      status(code) {
        response.statusCode = code
        return this
      },
      json(body) {
        response.body = body
        return this
      },
    }),
    helpers: { returnJsonArray: (list) => list.map((json) => ({ json })) },
  }
  return { ctx, response }
}

const sign = (secret, raw, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`, 'utf8').digest('hex')}`

module.exports = { KEY, executeContext, hookContext, webhookContext, sign }
