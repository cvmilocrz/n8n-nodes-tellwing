import type { IAuthenticateGeneric, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow'

/**
 * Credencial de Tellwing: una API key (Configuración → API). `tw_live_…`
 * trabaja con datos reales; `tw_test_…` con el sandbox, donde nada se envía.
 * La prueba es `GET /v1/me`, que cualquier key válida puede llamar.
 */
export class TellwingApi implements ICredentialType {
	name = 'tellwingApi'

	displayName = 'Tellwing API'

	icon = { light: 'file:tellwing.svg', dark: 'file:tellwing.dark.svg' } as const

	documentationUrl = 'https://tellwing.com/docs'

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Create it in Tellwing → Settings → API. Test keys (tw_test_…) never send anything. Permissions: subscribers:write, lists:read, templates:read, messages:send, events:write, webhooks:read, webhooks:write.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.tellwing.com/v1',
			description: 'Leave as is unless Tellwing support tells you otherwise',
		},
	]

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	}

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/me',
		},
	}
}
