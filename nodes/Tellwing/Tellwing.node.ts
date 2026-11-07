import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type ILoadOptionsFunctions,
	type INodeExecutionData,
	type INodePropertyOptions,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
} from 'n8n-workflow'
import { apiErrorMessage, compact, CONSENT_SOURCES, parseJsonObject, splitList, tellwingRequest } from '../shared/GenericFunctions'

/**
 * Nodo de acciones de Tellwing (TW-INT-03): crear o actualizar un suscriptor,
 * enviar un correo transaccional y registrar un evento que arranca los flujos
 * «Llegó un evento». Todo por `/v1` con la API key de la credencial.
 */
export class Tellwing implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Tellwing',
		name: 'tellwing',
		// Claro y oscuro: n8n pinta el que corresponde al tema del editor (verificación de nodos de comunidad).
		icon: { light: 'file:tellwing.svg', dark: 'file:tellwing.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Create subscribers, send transactional email and record events in Tellwing',
		defaults: { name: 'Tellwing' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'tellwingApi', required: true }],
		// Lo puede usar un agente de IA de n8n como herramienta (lo exige el lint de verificación).
		usableAsTool: true,
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Event', value: 'event' },
					{ name: 'Message', value: 'message' },
					{ name: 'Subscriber', value: 'subscriber' },
				],
				default: 'subscriber',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['subscriber'] } },
				options: [
					{
						name: 'Create or Update',
						value: 'createOrUpdate',
						description: 'Add a subscriber to a list, or update it if the email already exists',
						action: 'Create or update a subscriber',
					},
				],
				default: 'createOrUpdate',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['message'] } },
				options: [
					{
						name: 'Send',
						value: 'send',
						description: 'Send a transactional email (a receipt, a code) to any address. Not for marketing.',
						action: 'Send a transactional email',
					},
				],
				default: 'send',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['event'] } },
				options: [
					{
						name: 'Record',
						value: 'record',
						description: 'Record something that happened to a subscriber and start the automations for that event',
						action: 'Record an event',
					},
				],
				default: 'record',
			},

			// ---------------------------------------------------------------- suscriptor
			{
				displayName: 'List Name or ID',
				name: 'listId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getLists' },
				required: true,
				default: '',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				displayOptions: { show: { resource: ['subscriber'] } },
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'name@email.com',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['subscriber'] } },
			},
			{
				displayName: 'Consent Source',
				name: 'consentSource',
				type: 'options',
				options: CONSENT_SOURCES,
				required: true,
				default: 'website_form',
				description: 'Where the address came from. Required: Tellwing never adds a contact without a recorded basis for contacting them.',
				displayOptions: { show: { resource: ['subscriber'] } },
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['subscriber'] } },
				options: [
					{ displayName: 'Consent Date', name: 'consentTimestamp', type: 'dateTime', default: '' },
					{ displayName: 'Consent IP Address', name: 'consentIp', type: 'string', default: '' },
					{ displayName: 'Consent Text', name: 'consentText', type: 'string', default: '', description: 'The exact wording the person agreed to. Stored as evidence.' },
					{ displayName: 'First Name', name: 'firstName', type: 'string', default: '' },
					{ displayName: 'Last Name', name: 'lastName', type: 'string', default: '' },
					{
						displayName: 'Legal Basis',
						name: 'legalBasis',
						type: 'options',
						options: [
							{ name: 'Consent', value: 'consent' },
							{ name: 'Existing Customer (Soft Opt-In)', value: 'contractual_relationship' },
							{ name: 'Legitimate Interest', value: 'legitimate_interest' },
							{ name: 'Other', value: 'other' },
						],
						default: 'consent',
						description: 'Leaving it out declares consent. Legitimate interest and Other need a note.',
					},
					{ displayName: 'Legal Basis Note', name: 'legalBasisNote', type: 'string', default: '' },
					{ displayName: 'List Fields (JSON)', name: 'attributes', type: 'json', default: '{}', description: "Values for the list's custom columns, e.g. {\"city\": \"Bogotá\"}" },
					{ displayName: 'Phone', name: 'phone', type: 'string', default: '', description: 'International format, e.g. +573001234567. Gives no permission to message it.' },
					{ displayName: 'Subscribe Again', name: 'resubscribe', type: 'boolean', default: false, description: 'Whether to subscribe them again if they had unsubscribed (a new consent)' },
					{ displayName: 'Tags', name: 'tags', type: 'string', default: '', description: 'Comma-separated' },
				],
			},

			// ---------------------------------------------------------------- mensaje
			{
				displayName: 'To',
				name: 'to',
				type: 'string',
				required: true,
				default: '',
				description: 'One address, or several separated by commas',
				displayOptions: { show: { resource: ['message'] } },
			},
			{
				displayName: 'Content',
				name: 'content',
				type: 'options',
				options: [
					{ name: 'Template', value: 'template' },
					{ name: 'Write It Here', value: 'inline' },
				],
				default: 'template',
				displayOptions: { show: { resource: ['message'] } },
			},
			{
				displayName: 'Template Name or ID',
				name: 'templateId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getTemplates' },
				required: true,
				default: '',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				displayOptions: { show: { resource: ['message'], content: ['template'] } },
			},
			{
				// Pares nombre/valor en vez de un JSON libre: lo recomienda la verificación de n8n y es
				// más fácil de llenar (y de mapear con expresiones) para quien no escribe JSON.
				displayName: 'Variables',
				name: 'variablesUi',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				placeholder: 'Add Variable',
				default: {},
				description: 'Values for the template merge fields, e.g. code = 482913',
				displayOptions: { show: { resource: ['message'], content: ['template'] } },
				options: [
					{
						displayName: 'Variable',
						name: 'variable',
						values: [
							{ displayName: 'Name', name: 'name', type: 'string', default: '', description: 'Merge field name, without braces' },
							{ displayName: 'Value', name: 'value', type: 'string', default: '' },
						],
					},
				],
			},
			{
				displayName: 'Subject',
				name: 'subject',
				type: 'string',
				default: '',
				description: 'Required with your own content; with a template, it replaces the template subject',
				displayOptions: { show: { resource: ['message'] } },
			},
			{
				displayName: 'HTML',
				name: 'html',
				type: 'string',
				typeOptions: { rows: 6 },
				default: '',
				displayOptions: { show: { resource: ['message'], content: ['inline'] } },
			},
			{
				displayName: 'Text',
				name: 'text',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				description: 'Plain-text part. Derived from the HTML when empty.',
				displayOptions: { show: { resource: ['message'], content: ['inline'] } },
			},
			{
				displayName: 'Additional Fields',
				name: 'messageFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['message'] } },
				options: [
					{ displayName: 'Bcc', name: 'bcc', type: 'string', default: '', description: 'Comma-separated' },
					{ displayName: 'Cc', name: 'cc', type: 'string', default: '', description: 'Comma-separated' },
					{ displayName: 'Reply-To', name: 'replyTo', type: 'string', default: '', description: 'Must be on your sending domain or be your verified reply-to address' },
				],
			},

			// ---------------------------------------------------------------- evento
			{
				displayName: 'Event Name',
				name: 'eventName',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'order_paid',
				description: 'Letters, numbers, spaces and . _ - : / only. Compared without case.',
				displayOptions: { show: { resource: ['event'] } },
			},
			{
				displayName: 'Identify Subscriber By',
				name: 'identifyBy',
				type: 'options',
				options: [
					{ name: 'Email', value: 'email' },
					{ name: 'Subscriber ID', value: 'subscriberId' },
				],
				default: 'email',
				displayOptions: { show: { resource: ['event'] } },
			},
			{
				displayName: 'Email',
				name: 'eventEmail',
				type: 'string',
				placeholder: 'name@email.com',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['event'], identifyBy: ['email'] } },
			},
			{
				displayName: 'Subscriber ID',
				name: 'subscriberId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['event'], identifyBy: ['subscriberId'] } },
			},
			{
				displayName: 'Additional Fields',
				name: 'eventFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['event'] } },
				options: [
					{ displayName: 'Data (JSON)', name: 'data', type: 'json', default: '{}', description: 'Available in the flow as {{event.key}}' },
					{ displayName: 'Event ID', name: 'eventId', type: 'string', default: '', description: 'Your own ID (e.g. the order number). The same ID is accepted only once in 30 days.' },
				],
			},
		],
	}

	methods = {
		loadOptions: {
			async getLists(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const response = await tellwingRequest.call(this, 'GET', '/lists', undefined, { limit: 100 })
				return ((response?.data ?? []) as IDataObject[]).map((list) => ({ name: String(list.name), value: Number(list.id) }))
			},
			async getTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const response = await tellwingRequest.call(this, 'GET', '/templates', undefined, { limit: 100 })
				return ((response?.data ?? []) as IDataObject[]).map((template) => ({ name: String(template.name), value: String(template.id) }))
			},
		},
	}

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData()
		const out: INodeExecutionData[] = []
		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string
				let response: IDataObject
				if (resource === 'subscriber') response = await createOrUpdateSubscriber.call(this, i)
				else if (resource === 'message') response = await sendMessage.call(this, i)
				else response = await recordEvent.call(this, i)
				out.push({ json: response, pairedItem: { item: i } })
			} catch (error) {
				const message = apiErrorMessage(error)
				if (this.continueOnFail()) {
					out.push({ json: { error: message ?? (error as Error).message }, pairedItem: { item: i } })
					continue
				}
				if (message) throw new NodeApiError(this.getNode(), error as JsonObject, { message, itemIndex: i })
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i })
			}
		}
		return [out]
	}
}

async function createOrUpdateSubscriber(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const listId = this.getNodeParameter('listId', i) as string | number
	const extra = this.getNodeParameter('additionalFields', i, {}) as IDataObject
	const body = compact({
		email: this.getNodeParameter('email', i) as string,
		consent_source: this.getNodeParameter('consentSource', i) as string,
		name: extra.firstName,
		last_name: extra.lastName,
		phone: extra.phone,
		consent_text: extra.consentText,
		consent_timestamp: extra.consentTimestamp,
		consent_ip: extra.consentIp,
		legal_basis: extra.legalBasis,
		legal_basis_note: extra.legalBasisNote,
		tags: splitList(extra.tags),
		attributes: parseJsonObject(extra.attributes, 'List Fields'),
	})
	if (extra.resubscribe === true) body.resubscribe = true
	return tellwingRequest.call(this, 'POST', `/lists/${encodeURIComponent(String(listId))}/subscribers`, body)
}

async function sendMessage(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const content = this.getNodeParameter('content', i) as string
	const extra = this.getNodeParameter('messageFields', i, {}) as IDataObject
	const body = compact({
		to: splitList(this.getNodeParameter('to', i)),
		cc: splitList(extra.cc),
		bcc: splitList(extra.bcc),
		reply_to: extra.replyTo,
		subject: this.getNodeParameter('subject', i, '') as string,
	})
	if (content === 'template') {
		body.template_id = this.getNodeParameter('templateId', i) as string
		const pairs = ((this.getNodeParameter('variablesUi', i, {}) as IDataObject).variable ?? []) as Array<{ name?: string; value?: string }>
		const variables: IDataObject = {}
		for (const { name, value } of pairs) if (name && name.trim()) variables[name.trim()] = value ?? ''
		if (Object.keys(variables).length) body.variables = variables
	} else {
		Object.assign(body, compact({ html: this.getNodeParameter('html', i, '') as string, text: this.getNodeParameter('text', i, '') as string }))
		if (!body.html && !body.text) throw new NodeOperationError(this.getNode(), 'Write the HTML or the text of the message', { itemIndex: i })
	}
	return tellwingRequest.call(this, 'POST', '/messages', body)
}

async function recordEvent(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const identifyBy = this.getNodeParameter('identifyBy', i) as string
	const extra = this.getNodeParameter('eventFields', i, {}) as IDataObject
	const body = compact({
		event: this.getNodeParameter('eventName', i) as string,
		...(identifyBy === 'email' ? { email: this.getNodeParameter('eventEmail', i) as string } : { subscriber_id: this.getNodeParameter('subscriberId', i) as string }),
		id: extra.eventId,
		data: parseJsonObject(extra.data, 'Data'),
	})
	return tellwingRequest.call(this, 'POST', '/events', body)
}
