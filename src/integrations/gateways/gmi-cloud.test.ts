import { expect, test } from 'bun:test'

import { routeForPreset } from '../compatibility.js'
import { getProviderPresetUiMetadata } from '../providerUiMetadata.js'
import {
  isGmiCloudBaseUrl,
  resolveActiveRouteIdFromEnv,
  resolveRouteCredentialValue,
  resolveRouteIdFromBaseUrl,
} from '../routeMetadata.js'
import { resolveModelRuntimeLimits } from '../runtimeMetadata.js'
import gateway, { mapGmiCloudModel } from './gmi-cloud.js'

test('GMI Cloud uses a dedicated-key hybrid OpenAI-compatible gateway contract', () => {
  expect(gateway.defaultBaseUrl).toBe('https://api.gmi-serving.com/v1')
  expect(gateway.defaultModel).toBe('deepseek-ai/DeepSeek-V4-Pro')
  expect(gateway.setup.credentialEnvVars).toEqual(['GMI_API_KEY'])
  expect(gateway.setup.dedicatedCredentialsOnly).toBe(true)
  expect(gateway.preset?.apiKeyEnvVars).toEqual(['GMI_API_KEY'])
  expect(gateway.validation).toMatchObject({
    kind: 'credential-env',
    routing: { matchDefaultBaseUrl: true },
    credentialEnvVars: ['GMI_API_KEY'],
  })
  expect(gateway.transportConfig).toEqual({
    kind: 'openai-compatible',
    openaiShim: {
      supportsApiFormatSelection: false,
      supportsAuthHeaders: false,
      maxTokensField: 'max_tokens',
    },
  })
  expect(gateway.catalog?.source).toBe('hybrid')
  expect(gateway.catalog?.discovery?.requiresAuth).toBe(true)
  expect(gateway.catalog?.models?.map(model => model.apiName)).toEqual([
    'deepseek-ai/DeepSeek-V4-Pro',
    'deepseek-ai/DeepSeek-V4-Flash',
    'anthropic/claude-sonnet-4.6',
    'anthropic/claude-opus-4.7',
  ])
})

test('GMI Cloud preset resolves to its gateway route and reads GMI env vars', () => {
  expect(routeForPreset('gmi-cloud')).toEqual({
    vendorId: 'openai',
    gatewayId: 'gmi-cloud',
    routeId: 'gmi-cloud',
  })
  expect(
    getProviderPresetUiMetadata('gmi-cloud', {
      GMI_API_KEY: 'test-gmi-key',
    }),
  ).toMatchObject({
    apiKey: 'test-gmi-key',
    baseUrl: 'https://api.gmi-serving.com/v1',
    model: 'deepseek-ai/DeepSeek-V4-Pro',
    provider: 'gmi-cloud',
    routeId: 'gmi-cloud',
  })
  expect(
    getProviderPresetUiMetadata('gmi-cloud', {
      GMI_API_KEY: 'test-gmi-key',
      GMI_MODEL: 'anthropic/claude-sonnet-4.6',
      OPENAI_MODEL: 'custom-openai-model',
    }),
  ).toMatchObject({
    model: 'anthropic/claude-sonnet-4.6',
  })
})

test('curated Claude models are not capped by the shared 8,192-token descriptors', () => {
  expect(
    resolveModelRuntimeLimits({
      model: 'anthropic/claude-sonnet-4.6',
      resolvedRouteId: 'gmi-cloud',
      processEnv: {},
    }),
  ).toMatchObject({ contextWindow: 200_000, maxOutputTokens: 64_000 })
  expect(
    resolveModelRuntimeLimits({
      model: 'anthropic/claude-opus-4.7',
      resolvedRouteId: 'gmi-cloud',
      processEnv: {},
    }),
  ).toMatchObject({ contextWindow: 200_000, maxOutputTokens: 128_000 })
})

test("GMI's Anthropic-compatible endpoint on the same host stays a custom Anthropic route", () => {
  expect(
    resolveActiveRouteIdFromEnv({
      ANTHROPIC_BASE_URL: 'https://api.gmi-serving.com',
      ANTHROPIC_API_KEY: 'gmi-key',
      ANTHROPIC_MODEL: 'anthropic/claude-sonnet-4.6',
    }),
  ).toBe('custom-anthropic')
  expect(
    resolveActiveRouteIdFromEnv({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'https://api.gmi-serving.com/v1',
      GMI_API_KEY: 'gmi-key',
    }),
  ).toBe('gmi-cloud')
})

test('GMI Cloud routes by its base URL and never falls back to a generic OpenAI key', () => {
  expect(resolveRouteIdFromBaseUrl('https://api.gmi-serving.com/v1')).toBe(
    'gmi-cloud',
  )
  expect(isGmiCloudBaseUrl('https://api.gmi-serving.com/v1')).toBe(true)
  expect(isGmiCloudBaseUrl('https://API.GMI-SERVING.COM/v1/')).toBe(true)
  expect(isGmiCloudBaseUrl('https://api.gmi-serving.com.evil.example/v1')).toBe(
    false,
  )
  expect(isGmiCloudBaseUrl('https://evil.example/api.gmi-serving.com/v1')).toBe(
    false,
  )
  expect(isGmiCloudBaseUrl('https://evil-gmi-serving.com/v1')).toBe(false)
  expect(isGmiCloudBaseUrl('https://gmi-serving.com/v1')).toBe(false)
  expect(isGmiCloudBaseUrl('not a url')).toBe(false)
  expect(isGmiCloudBaseUrl(undefined)).toBe(false)

  expect(
    resolveRouteCredentialValue({
      routeId: 'gmi-cloud',
      baseUrl: 'https://api.gmi-serving.com/v1',
      processEnv: { OPENAI_API_KEY: 'sk-openai-generic' },
    }),
  ).toBeUndefined()
  expect(
    resolveRouteCredentialValue({
      routeId: 'gmi-cloud',
      baseUrl: 'https://api.gmi-serving.com/v1',
      processEnv: {
        OPENAI_API_KEY: 'sk-openai-generic',
        GMI_API_KEY: 'gmi-key',
      },
    }),
  ).toBe('gmi-key')
})

test('mapGmiCloudModel keeps chat models and forwards reported limits', () => {
  expect(
    mapGmiCloudModel({
      id: ' Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8 ',
      context_length: 262_144,
      max_output_tokens: 65_536,
    }),
  ).toEqual({
    id: 'Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8',
    apiName: 'Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8',
    label: 'Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8',
    contextWindow: 262_144,
    maxOutputTokens: 65_536,
  })
  expect(
    mapGmiCloudModel({ id: 'moonshotai/Kimi-K2.6', display_name: 'Kimi K2.6' }),
  ).toEqual({
    id: 'moonshotai/Kimi-K2.6',
    apiName: 'moonshotai/Kimi-K2.6',
    label: 'Kimi K2.6',
  })
  expect(
    mapGmiCloudModel({ id: 'openai/gpt-5.5', context_length: -1 }),
  ).toEqual({
    id: 'openai/gpt-5.5',
    apiName: 'openai/gpt-5.5',
    label: 'openai/gpt-5.5',
  })
})

test('mapGmiCloudModel drops non-chat and malformed entries', () => {
  expect(
    mapGmiCloudModel({ id: 'laion/CLIP-ViT-B-32-laion2B-s34B-b79K' }),
  ).toBeNull()
  expect(mapGmiCloudModel({ id: 'Qwen/Qwen3-Embedding-8B' })).toBeNull()
  expect(mapGmiCloudModel({ id: 'Qwen/Qwen-Image' })).toBeNull()
  expect(mapGmiCloudModel({ id: 'google/gemini-3-pro-image-preview' })).toBeNull()
  expect(mapGmiCloudModel({ id: 'hexgrad/Kokoro-TTS' })).toBeNull()
  // "tts" and "image" only count as whole name segments.
  expect(
    mapGmiCloudModel({ id: 'mattshumer/Reflection-Llama-3.1-70B' })?.id,
  ).toBe('mattshumer/Reflection-Llama-3.1-70B')
  expect(mapGmiCloudModel({ id: '' })).toBeNull()
  expect(mapGmiCloudModel({ object: 'model' })).toBeNull()
  expect(mapGmiCloudModel(null)).toBeNull()
  expect(mapGmiCloudModel('deepseek-ai/DeepSeek-V4-Pro')).toBeNull()
})
