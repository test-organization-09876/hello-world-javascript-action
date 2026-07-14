import * as core from '@actions/core'
import * as github from '@actions/github'

function getTargetBranch() {
  if (github.context.ref?.startsWith('refs/heads/')) {
    return github.context.ref.replace('refs/heads/', '')
  }

  return null
}

function getDecodedContent(fileResponse) {
  if (Array.isArray(fileResponse.data)) {
    throw new Error('Expected a file response but received a directory listing.')
  }

  return Buffer.from(fileResponse.data.content, 'base64').toString('utf8')
}

function getTriggeringCommitMessage() {
  return github.context.payload?.head_commit?.message || null
}

async function addDependencyToPackageJson({
  token,
  dependencyName,
  dependencyVersion,
  commitMessage
}) {
  const { owner, repo } = github.context.repo
  const branch = getTargetBranch()

  if (!branch) {
    core.warning(
      'Package update side effect skipped because this run is not on a branch ref.'
    )
    return
  }

  const octokit = github.getOctokit(token)

  const packageJsonResponse = await octokit.rest.repos.getContent({
    owner,
    repo,
    path: 'package.json',
    ref: branch
  })

  if (Array.isArray(packageJsonResponse.data) || !packageJsonResponse.data.sha) {
    throw new Error('Unable to read package.json as a file from the target branch.')
  }

  const packageJson = JSON.parse(getDecodedContent(packageJsonResponse))
  const dependencies = packageJson.dependencies || {}
  const existingVersion = dependencies[dependencyName]

  if (existingVersion === dependencyVersion) {
    core.info(
      `Package side effect skipped: dependencies already include ${dependencyName}@${dependencyVersion}.`
    )
    return
  }

  dependencies[dependencyName] = dependencyVersion
  packageJson.dependencies = dependencies
  const updatedPackageJson = `${JSON.stringify(packageJson, null, 2)}\n`

  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: 'package.json',
    message: commitMessage,
    content: Buffer.from(updatedPackageJson).toString('base64'),
    branch,
    sha: packageJsonResponse.data.sha
  })

  core.info(
    `Package side effect committed ${dependencyName}@${dependencyVersion} to ${owner}/${repo}@${branch}.`
  )
}

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run() {
  try {
    // The `who-to-greet` input is defined in action metadata file
    const whoToGreet = core.getInput('who-to-greet', { required: true })
    core.info(`Hello, ${whoToGreet}!`)

    // Get the current time and set as an output
    const time = new Date().toTimeString()
    core.setOutput('time', time)

    // Output the payload for debugging
    core.info(
      `The event payload: ${JSON.stringify(github.context.payload, null, 2)}`
    )

    const token = core.getInput('github-token')
    const dependencyName = core.getInput('demo-dependency-name') || 'lodash'
    const dependencyVersion =
      core.getInput('demo-dependency-version') || '^4.17.21'
    const commitMessage =
      getTriggeringCommitMessage() ||
      core.getInput('demo-commit-message') ||
      'demo(action): add dependency from third-party action'

    await addDependencyToPackageJson({
      token,
      dependencyName,
      dependencyVersion,
      commitMessage
    })
  } catch (error) {
    // Fail the workflow step if an error occurs
    core.setFailed(error.message)
  }
}
