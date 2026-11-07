'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const pkg = require('../package.json')
const { TellwingApi } = require('../dist/credentials/TellwingApi.credentials.js')

const root = path.resolve(__dirname, '..')

test('el paquete cumple lo que n8n pide a un nodo de comunidad', () => {
  assert.match(pkg.name, /^n8n-nodes-/)
  assert.ok(pkg.keywords.includes('n8n-community-node-package'))
  assert.equal(pkg.license, 'MIT')
  // Los nodos verificados no pueden tener dependencias en tiempo de ejecución.
  assert.equal(pkg.dependencies, undefined)
  for (const file of [...pkg.n8n.credentials, ...pkg.n8n.nodes]) assert.ok(fs.existsSync(path.join(root, file)), `${file} no se compiló`)
  for (const dir of ['credentials', 'nodes/Tellwing', 'nodes/TellwingTrigger']) assert.ok(fs.existsSync(path.join(root, 'dist', dir, 'tellwing.svg')))
})

test('la credencial manda la key como Bearer y se prueba con GET /me', () => {
  const credential = new TellwingApi()
  assert.equal(credential.authenticate.properties.headers.Authorization, '=Bearer {{$credentials.apiKey}}')
  assert.equal(credential.test.request.url, '/me')
  assert.equal(credential.properties.find((p) => p.name === 'baseUrl').default, 'https://api.tellwing.com/v1')
})

/**
 * Cada ruta que usan los nodos existe en el contrato (docs/openapi.yaml del
 * repositorio core), con ese método. Se lee el YAML con una expresión regular:
 * así esta prueba no necesita un parser de YAML como dependencia.
 */
// En el repositorio público del nodo (github.com/cvmilocrz/n8n-nodes-tellwing) no está el contrato
// de la API: la prueba corre solo dentro del monorepo de Tellwing, donde sí está.
const openapi = path.resolve(root, '../../docs/openapi.yaml')
test('las rutas que usan los nodos están en docs/openapi.yaml', { skip: !fs.existsSync(openapi) && 'sin docs/openapi.yaml (repositorio público)' }, () => {
  const yaml = fs.readFileSync(openapi, 'utf8')
  const paths = new Map()
  let current = null
  for (const line of yaml.split('\n')) {
    const p = line.match(/^ {2}(\/[^:]*):\s*$/)
    if (p) {
      current = p[1]
      paths.set(current, new Set())
      continue
    }
    if (/^\S/.test(line)) current = null
    const m = current && line.match(/^ {4}(get|post|put|patch|delete):/)
    if (m) paths.get(current).add(m[1].toUpperCase())
  }
  const used = [
    ['GET', '/me'], ['GET', '/lists'], ['GET', '/templates'], ['POST', '/lists/{id}/subscribers'], ['POST', '/messages'],
    ['POST', '/events'], ['GET', '/webhooks'], ['POST', '/webhooks'], ['DELETE', '/webhooks/{id}'],
  ]
  for (const [method, p] of used) assert.ok(paths.get(p)?.has(method), `${method} ${p} no está en docs/openapi.yaml`)
})
