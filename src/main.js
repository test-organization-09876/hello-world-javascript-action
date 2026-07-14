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
    throw new Error(
      'Expected a file response but received a directory listing.'
    )
  }

  return Buffer.from(fileResponse.data.content, 'base64').toString('utf8')
}

function getTriggeringCommitMessage() {
  return github.context.payload?.head_commit?.message || null
}

function escapeForRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeForXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function upsertDependencyInPom({ pomXml, groupId, artifactId, version }) {
  const escapedGroupId = escapeForRegex(groupId)
  const escapedArtifactId = escapeForRegex(artifactId)
  const dependencyRegex = new RegExp(
    `<dependency>\\s*<groupId>${escapedGroupId}<\\/groupId>\\s*<artifactId>${escapedArtifactId}<\\/artifactId>[\\s\\S]*?<\\/dependency>`,
    'm'
  )
  const dependencyMatch = pomXml.match(dependencyRegex)

  if (dependencyMatch) {
    const existingDependencyBlock = dependencyMatch[0]
    const versionRegex = /<version>\s*([^<]+?)\s*<\/version>/m
    const versionMatch = existingDependencyBlock.match(versionRegex)

    if (versionMatch && versionMatch[1] === version) {
      return { updatedPomXml: pomXml, changed: false }
    }

    let updatedDependencyBlock = existingDependencyBlock
    if (versionMatch) {
      updatedDependencyBlock = existingDependencyBlock.replace(
        versionRegex,
        `<version>${escapeForXml(version)}</version>`
      )
    } else {
      updatedDependencyBlock = existingDependencyBlock.replace(
        '</dependency>',
        `    <version>${escapeForXml(version)}</version>\n  </dependency>`
      )
    }

    return {
      updatedPomXml: pomXml.replace(
        existingDependencyBlock,
        updatedDependencyBlock
      ),
      changed: true
    }
  }

  const newDependencyBlock = [
    '    <dependency>',
    `      <groupId>${escapeForXml(groupId)}</groupId>`,
    `      <artifactId>${escapeForXml(artifactId)}</artifactId>`,
    `      <version>${escapeForXml(version)}</version>`,
    '    </dependency>'
  ].join('\n')

  const dependenciesRegex = /<dependencies>([\s\S]*?)<\/dependencies>/m
  const dependenciesMatch = pomXml.match(dependenciesRegex)

  if (dependenciesMatch) {
    const innerContent = dependenciesMatch[1]
    const trimmedInnerContent = innerContent.replace(/\s*$/, '')
    const joinedInnerContent = trimmedInnerContent.trim()
      ? `${trimmedInnerContent}\n${newDependencyBlock}\n`
      : `\n${newDependencyBlock}\n`

    return {
      updatedPomXml: pomXml.replace(
        dependenciesRegex,
        `<dependencies>${joinedInnerContent}</dependencies>`
      ),
      changed: true
    }
  }

  if (!pomXml.includes('</project>')) {
    throw new Error(
      'Unable to locate </project> in pom.xml while adding dependency.'
    )
  }

  const dependenciesBlock = `  <dependencies>\n${newDependencyBlock}\n  </dependencies>\n`
  return {
    updatedPomXml: pomXml.replace(
      '</project>',
      `${dependenciesBlock}</project>`
    ),
    changed: true
  }
}

async function addDependencyToPomXml({
  token,
  dependencyGroupId,
  dependencyArtifactId,
  dependencyVersion,
  commitMessage
}) {
  const { owner, repo } = github.context.repo
  const branch = getTargetBranch()

  if (!branch) {
    core.warning(
      'pom.xml update side effect skipped because this run is not on a branch ref.'
    )
    return
  }

  const octokit = github.getOctokit(token)

  const pomXmlResponse = await octokit.rest.repos.getContent({
    owner,
    repo,
    path: 'pom.xml',
    ref: branch
  })

  if (Array.isArray(pomXmlResponse.data) || !pomXmlResponse.data.sha) {
    throw new Error('Unable to read pom.xml as a file from the target branch.')
  }

  const pomXml = getDecodedContent(pomXmlResponse)
  const { updatedPomXml, changed } = upsertDependencyInPom({
    pomXml,
    groupId: dependencyGroupId,
    artifactId: dependencyArtifactId,
    version: dependencyVersion
  })

  if (!changed) {
    core.info(
      `pom.xml side effect skipped: dependencies already include ${dependencyGroupId}:${dependencyArtifactId}:${dependencyVersion}.`
    )
    return
  }

  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: 'pom.xml',
    message: commitMessage,
    content: Buffer.from(updatedPomXml).toString('base64'),
    branch,
    sha: pomXmlResponse.data.sha
  })

  core.info(
    `pom.xml side effect committed ${dependencyGroupId}:${dependencyArtifactId}:${dependencyVersion} to ${owner}/${repo}@${branch}.`
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
    const dependencyGroupId =
      core.getInput('demo-dependency-group-id') || 'org.apache.commons'
    const dependencyArtifactId =
      core.getInput('demo-dependency-artifact-id') || 'commons-lang3'
    const dependencyVersion =
      core.getInput('demo-dependency-version') || '3.17.0'
    const commitMessage =
      getTriggeringCommitMessage() ||
      core.getInput('demo-commit-message') ||
      'demo(action): add Maven dependency from third-party action'

    await addDependencyToPomXml({
      token,
      dependencyGroupId,
      dependencyArtifactId,
      dependencyVersion,
      commitMessage
    })
  } catch (error) {
    // Fail the workflow step if an error occurs
    core.setFailed(error.message)
  }
}
