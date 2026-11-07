import { createHmac, randomUUID, timingSafeEqual } from 'crypto'
import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
} from 'n8n-workflow'

export const DEFAULT_BASE_URL = 'https://api.tellwing.com/v1'

/** Los eventos de los webhooks salientes (`x-webhooks.events` de docs/openapi.yaml). */
export const EVENT_TYPES = [
	{ name: 'Subscriber Created', value: 'subscriber.created', description: 'Someone was added to one of your lists' },
	{ name: 'Subscriber Unsubscribed', value: 'subscriber.unsubscribed', description: 'A subscriber left a list or unsubscribed from everything' },
	{ name: 'Campaign Sent', value: 'campaign.sent', description: 'A campaign finished sending' },
	{ name: 'Email Delivered', value: 'email.delivered', description: "An email reached the recipient's mail server" },
	{ name: 'Email Opened', value: 'email.opened', description: 'A recipient opened a tracked email' },
	{ name: 'Email Clicked', value: 'email.clicked', description: 'A recipient clicked a link in a tracked email' },
	{ name: 'Email Bounced', value: 'email.bounced', description: 'An email bounced' },
	{ name: 'Email Complained', value: 'email.complained', description: 'A recipient marked an email as spam' },
]

export const CONSENT_SOURCES = [
	{ name: 'Website Form', value: 'website_form' },
	{ name: 'Checkout', value: 'checkout' },
	{ name: 'Event', value: 'event' },
	{ name: 'Import With Consent', value: 'import_with_consent' },
	{ name: 'Other (API)', value: 'api_other' },
]

type Context = IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions | IWebhookFunctions

/**
 * Una petición a la API de Tellwing con la credencial del nodo. Cada POST
 * lleva un `Idempotency-Key` nuevo: si la red corta la respuesta y n8n
 * reintenta la misma petición, la API repite la respuesta guardada en vez de
 * dar de alta o enviar dos veces.
 */
export async function tellwingRequest(
	this: Context,
	method: IHttpRequestMethods,
	path: string,
	body?: IDataObject,
	qs?: IDataObject,
	options: { ignoreHttpStatusErrors?: boolean; returnFullResponse?: boolean } = {},
): Promise<any> {
	const credentials = await this.getCredentials('tellwingApi')
	const baseUrl = String(credentials.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
	const request: IHttpRequestOptions = {
		method,
		url: `${baseUrl}${path}`,
		json: true,
		headers: { Accept: 'application/json' },
		...(qs ? { qs } : {}),
		...(body !== undefined ? { body } : {}),
		...(options.ignoreHttpStatusErrors ? { ignoreHttpStatusErrors: true } : {}),
		...(options.returnFullResponse ? { returnFullResponse: true } : {}),
	}
	if (method === 'POST') request.headers = { ...request.headers, 'Idempotency-Key': randomUUID() }
	return this.helpers.httpRequestWithAuthentication.call(this, 'tellwingApi', request)
}

/**
 * El texto de un error de la API (`{ error: { code, message, param } }`) para
 * enseñárselo a la persona, con el campo que falló.
 */
export function apiErrorMessage(error: unknown): string | null {
	const e = error as { response?: { body?: unknown; data?: unknown }; cause?: { response?: { data?: unknown } } } | null
	const body = (e?.response?.body ?? e?.response?.data ?? e?.cause?.response?.data) as { error?: { message?: string; param?: string | null } } | undefined
	if (!body || typeof body !== 'object' || !body.error) return null
	return `${body.error.message ?? 'Tellwing rejected the request.'}${body.error.param ? ` (field: ${body.error.param})` : ''}`
}

/** Quita los campos vacíos: la API leería `""` como un valor (una base legal inválida, un nombre borrado). */
export function compact(object: IDataObject): IDataObject {
	const out: IDataObject = {}
	for (const [key, value] of Object.entries(object)) {
		if (value === undefined || value === null) continue
		if (typeof value === 'string' && value.trim() === '') continue
		if (Array.isArray(value) && value.length === 0) continue
		if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) continue
		out[key] = value
	}
	return out
}

/** Texto con comas → arreglo de textos sin vacíos. */
export function splitList(value: unknown): string[] {
	if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean)
	if (typeof value !== 'string') return []
	return value.split(',').map((v) => v.trim()).filter(Boolean)
}

/** Un campo JSON del nodo (texto u objeto ya parseado) → objeto, o error legible. */
export function parseJsonObject(value: unknown, field: string): IDataObject | undefined {
	if (value === undefined || value === null || value === '') return undefined
	const parsed = typeof value === 'string' ? JSON.parse(value) : value
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${field} must be a JSON object`)
	return parsed as IDataObject
}

/**
 * Verifica `Tellwing-Signature: t=<s>,v1=<hex HMAC-SHA256 de "<t>.<cuerpo crudo>">`
 * con el secret del endpoint. Siempre sobre el cuerpo CRUDO (volver a
 * serializar el JSON cambia los bytes), con 300 s de tolerancia y comparación
 * en tiempo constante.
 */
export function verifySignature(secret: string | undefined, rawBody: string | undefined, header: string | undefined, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
	if (!secret || typeof rawBody !== 'string' || typeof header !== 'string') return false
	let timestamp = NaN
	const signatures: string[] = []
	for (const part of header.split(',')) {
		const eq = part.indexOf('=')
		if (eq === -1) continue
		const key = part.slice(0, eq).trim()
		const value = part.slice(eq + 1).trim()
		if (key === 't') timestamp = Number(value)
		else if (key === 'v1' && /^[0-9a-f]+$/i.test(value)) signatures.push(value.toLowerCase())
	}
	if (!Number.isFinite(timestamp) || signatures.length === 0 || Math.abs(nowSeconds - timestamp) > 300) return false
	const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest()
	return signatures.some((candidate) => {
		const given = Buffer.from(candidate, 'hex')
		return given.length === expected.length && timingSafeEqual(given, expected)
	})
}
