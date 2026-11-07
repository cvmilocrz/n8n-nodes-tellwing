import {
	NodeConnectionTypes,
	type IDataObject,
	type IHookFunctions,
	type INodeType,
	type INodeTypeDescription,
	type IWebhookFunctions,
	type IWebhookResponseData,
} from 'n8n-workflow'
import { EVENT_TYPES, tellwingRequest, verifySignature } from '../shared/GenericFunctions'

/**
 * Disparador de Tellwing (TW-INT-03). Al activar el flujo crea un endpoint en
 * Tellwing (`POST /v1/webhooks`) con la URL del webhook de n8n y los eventos
 * elegidos; al desactivarlo lo borra. El `id` y el `secret` de la firma quedan
 * en los datos estáticos del nodo, nunca en la salida. Cada entrega se
 * verifica con `Tellwing-Signature` sobre el cuerpo crudo: una firma que no
 * cuadra responde 401 y no arranca el flujo.
 *
 * Con una credencial de prueba (`tw_test_…`) el endpoint recibe solo eventos
 * del sandbox (`"livemode": false`).
 */
export class TellwingTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Tellwing Trigger',
		name: 'tellwingTrigger',
		// Claro y oscuro: n8n pinta el que corresponde al tema del editor (verificación de nodos de comunidad).
		icon: { light: 'file:tellwing.svg', dark: 'file:tellwing.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when Tellwing sends an event (new subscriber, unsubscribe, campaign sent, email delivered, opened, clicked, bounced or marked as spam)',
		defaults: { name: 'Tellwing Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'tellwingApi', required: true }],
		webhooks: [{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'webhook' }],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				options: EVENT_TYPES,
				required: true,
				default: [],
			},
		],
	}

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node')
				if (!data.webhookId) return false
				const response = await tellwingRequest.call(this, 'GET', '/webhooks')
				const url = this.getNodeWebhookUrl('default')
				const events = [...(this.getNodeParameter('events') as string[])].sort().join(',')
				const found = ((response?.data ?? []) as IDataObject[]).find((w) => w.id === data.webhookId)
				// Otro URL o eventos cambiados: se borra y se vuelve a crear con lo de ahora.
				if (found && found.url === url && [...((found.events as string[]) ?? [])].sort().join(',') === events && found.status === 'active') return true
				if (found) await tellwingRequest.call(this, 'DELETE', `/webhooks/${encodeURIComponent(String(data.webhookId))}`, undefined, undefined, { ignoreHttpStatusErrors: true })
				delete data.webhookId
				delete data.webhookSecret
				return false
			},
			async create(this: IHookFunctions): Promise<boolean> {
				const response = await tellwingRequest.call(this, 'POST', '/webhooks', {
					url: this.getNodeWebhookUrl('default'),
					events: this.getNodeParameter('events') as string[],
					description: 'n8n',
				})
				if (!response?.id || !response?.secret) return false
				const data = this.getWorkflowStaticData('node')
				data.webhookId = response.id
				data.webhookSecret = response.secret
				return true
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node')
				if (data.webhookId) {
					// 404: ya no existía (borrado en Tellwing); para n8n eso también es «borrado».
					await tellwingRequest.call(this, 'DELETE', `/webhooks/${encodeURIComponent(String(data.webhookId))}`, undefined, undefined, { ignoreHttpStatusErrors: true })
				}
				delete data.webhookId
				delete data.webhookSecret
				return true
			},
		},
	}

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject() as unknown as { rawBody?: Buffer | string; body?: IDataObject }
		const headers = this.getHeaderData() as IDataObject
		const raw = Buffer.isBuffer(request.rawBody) ? request.rawBody.toString('utf8') : request.rawBody
		const secret = this.getWorkflowStaticData('node').webhookSecret as string | undefined
		if (!verifySignature(secret, raw, headers['tellwing-signature'] as string | undefined)) {
			const res = this.getResponseObject()
			res.status(401).json({ error: 'invalid_signature' })
			return { noWebhookResponse: true }
		}
		const event = (request.body ?? {}) as IDataObject
		// El `ping` de «Enviar prueba» y cualquier evento no elegido no arrancan el flujo.
		const wanted = this.getNodeParameter('events') as string[]
		if (!wanted.includes(String(event.type))) return { webhookResponse: { received: true } }
		return { workflowData: [this.helpers.returnJsonArray([event])] }
	}
}
