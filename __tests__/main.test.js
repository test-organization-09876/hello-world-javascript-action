/**
 * Unit tests for the action's main functionality, src/main.js
 */
import { afterEach, beforeEach, jest } from '@jest/globals'
const core = await import('../__fixtures__/core')
const github = await import('../__fixtures__/github')

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/github', () => github)

const main = await import('../src/main')

describe('action', () => {
  beforeEach(() => {
    // Mock the action's inputs
    core.getInput.mockReturnValueOnce('World')

    // Mock the action's payload
    github.context.payload = {
      actor: 'mona'
    }
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('sets the time output', async () => {
    await main.run()

    expect(core.setOutput).toHaveBeenCalledWith('time', expect.any(String))
  })

  it('logs the event payload', async () => {
    await main.run()

    expect(core.info).toHaveBeenCalledWith(
      `The event payload: ${JSON.stringify(github.context.payload, null, 2)}`
    )
  })

  it('commits a package.json dependency side effect', async () => {
    const packageJson = {
      name: 'hello-world-javascript-action',
      dependencies: {
        '@actions/core': '^2.0.2'
      }
    }

    const octokit = {
      rest: {
        repos: {
          getContent: jest.fn().mockResolvedValue({
            data: {
              sha: 'abc123',
              content: Buffer.from(JSON.stringify(packageJson, null, 2)).toString(
                'base64'
              )
            }
          }),
          createOrUpdateFileContents: jest.fn()
        }
      }
    }

    core.getInput.mockImplementation((name) => {
      if (name === 'who-to-greet') {
        return 'World'
      }

      if (name === 'github-token') {
        return 'ghs_demo'
      }

      if (name === 'demo-dependency-name') {
        return 'lodash'
      }

      if (name === 'demo-dependency-version') {
        return '^4.17.21'
      }

      if (name === 'demo-commit-message') {
        return 'demo(action): side effect'
      }

      return ''
    })

    github.getOctokit.mockReturnValueOnce(octokit)

    await main.run()

    expect(github.getOctokit).toHaveBeenCalledWith('ghs_demo')
    expect(octokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        path: 'package.json',
        branch: 'main',
        message: 'demo(action): side effect',
        sha: 'abc123'
      })
    )
  })

  it('sets a failed status', async () => {
    // Mock a failure
    core.getInput.mockReset().mockImplementation((name) => {
      throw new Error('Something went wrong...')
    })

    await main.run()

    expect(core.setFailed).toHaveBeenCalledWith('Something went wrong...')
  })
})
