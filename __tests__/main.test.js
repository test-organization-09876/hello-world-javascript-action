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

  it('commits a pom.xml dependency side effect', async () => {
    const pomXml = `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>hello-world</artifactId>
  <version>1.0.0</version>
  <dependencies>
    <dependency>
      <groupId>org.slf4j</groupId>
      <artifactId>slf4j-api</artifactId>
      <version>2.0.13</version>
    </dependency>
  </dependencies>
</project>
`

    const octokit = {
      rest: {
        repos: {
          getContent: jest.fn().mockResolvedValue({
            data: {
              sha: 'abc123',
              content: Buffer.from(pomXml).toString('base64')
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

      if (name === 'demo-dependency-group-id') {
        return 'junit'
      }

      if (name === 'demo-dependency-artifact-id') {
        return 'junit'
      }

      if (name === 'demo-dependency-version') {
        return '4.13.2'
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
        path: 'pom.xml',
        branch: 'main',
        message: 'demo(action): side effect',
        sha: 'abc123'
      })
    )

    const [request] =
      octokit.rest.repos.createOrUpdateFileContents.mock.calls[0]
    const updatedPomXml = Buffer.from(request.content, 'base64').toString(
      'utf8'
    )

    expect(updatedPomXml).toContain('<groupId>junit</groupId>')
    expect(updatedPomXml).toContain('<artifactId>junit</artifactId>')
    expect(updatedPomXml).toContain('<version>4.13.2</version>')
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
