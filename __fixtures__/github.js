import { jest } from '@jest/globals'

export const context = {
  payload: {
    actor: 'mona'
  },
  repo: {
    owner: 'octocat',
    repo: 'hello-world'
  },
  ref: 'refs/heads/main',
  workflow: 'Example Workflow',
  runId: 123,
  actor: 'mona'
}

export const getOctokit = jest.fn()
