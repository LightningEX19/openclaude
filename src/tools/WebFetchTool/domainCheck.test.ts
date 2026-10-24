import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import axios from 'axios'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'

const originalEnv = { ...process.env }
const originalAxiosGet = axios.get
const originalMacro = (globalThis as Record<string, unknown>).MACRO
const hadOriginalMacro = Object.hasOwn(globalThis, 'MACRO')
const _realProvidersModule = await import(
  `../../utils/model/providers.js?real=${Date.now()}-${Math.random()}`,
)
const realProviders = { ..._realProvidersModule }

async function importFreshModule(isFirstPartyAnthropicProvider?: boolean) {
  mock.restore()
  mock.module('../../utils/model/providers.js', () => ({
    ...realProviders,
    ...(isFirstPartyAnthropicProvider === undefined
      ? {}
      : { isFirstPartyAnthropicProvider: () => isFirstPartyAnthropicProvider }),
  }))
  return import(`./utils.ts?ts=${Date.now()}-${Math.random()}`)
}

beforeEach(async () => {
  await acquireSharedMutationLock('tools/WebFetchTool/domainCheck.test.ts')
  process.env = { ...originalEnv }
  ;(globalThis as Record<string, unknown>).MACRO = {
    VERSION: '0.0.0-test',
  }
})

afterEach(() => {
  try {
    process.env = { ...originalEnv }
    axios.get = originalAxiosGet
    if (hadOriginalMacro) {
      ;(globalThis as Record<string, unknown>).MACRO = originalMacro
    } else {
      delete (globalThis as Record<string, unknown>).MACRO
    }
    mock.restore()
    mock.module('../../utils/model/providers.js', () => realProviders)
  } finally {
    releaseSharedMutationLock()
  }
})

describe('checkDomainBlocklist', () => {
  test('returns allowed without API call in OpenAI mode', async () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    const getSpy = mock(() =>
      Promise.resolve({ status: 200, data: { can_fetch: true } }),
    )
    axios.get = getSpy as typeof axios.get

    const { checkDomainBlocklist } = await importFreshModule()
    const result = await checkDomainBlocklist('example.com')

    expect(result.status).toBe('allowed')
    expect(getSpy).not.toHaveBeenCalled()
  })

  test('returns allowed without API call in Gemini mode', async () => {
    process.env.CLAUDE_CODE_USE_GEMINI = '1'
    const getSpy = mock(() =>
      Promise.resolve({ status: 200, data: { can_fetch: true } }),
    )
    axios.get = getSpy as typeof axios.get

    const { checkDomainBlocklist } = await importFreshModule()
    const result = await checkDomainBlocklist('example.com')

    expect(result.status).toBe('allowed')
    expect(getSpy).not.toHaveBeenCalled()
  })

  test('calls Anthropic domain check in first-party mode', async () => {
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.CLAUDE_CODE_USE_GEMINI
    delete process.env.CLAUDE_CODE_USE_GITHUB

    const getSpy = mock(() =>
      Promise.resolve({ status: 200, data: { can_fetch: true } }),
    )
    axios.get = getSpy as typeof axios.get

    const { checkDomainBlocklist } = await importFreshModule(true)
    const result = await checkDomainBlocklist('example.com')

    expect(result.status).toBe('allowed')
    expect(getSpy).toHaveBeenCalledTimes(1)
  })
})

describe('getWithPermittedRedirects', () => {
  test('reports HTTP 404 responses as not found', async () => {
    const error = Object.assign(
      new Error('Request failed with status code 404'),
      {
        isAxiosError: true,
        response: {
          status: 404,
          headers: {},
          data: new ArrayBuffer(0),
        },
      },
    )
    axios.get = mock(() => Promise.reject(error)) as typeof axios.get

    const { getWithPermittedRedirects } = await importFreshModule()

    await expect(
      getWithPermittedRedirects(
        'https://example.com/missing',
        new AbortController().signal,
        () => true,
      ),
    ).rejects.toThrow('WebFetch request failed: HTTP 404 Not Found')
  })
})
