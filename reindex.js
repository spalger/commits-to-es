const {
  resolve,
  extname,
  sep: pathSep,
  dirname,
  basename,
} = require('path')

const elasticsearch = require('elasticsearch')
const { Repository } = require('nodegit')

async function main() {
  const REPO_DIR = resolve(process.env.REPO_DIR)
  const GIT_DIFF_LINE_ADDITION = '+'.charCodeAt(0)
  const INDEX_NAME = 'commits'
  const TYPE_NAME = 'docs'

  const MINUTE = 60 * 1000
  const HOUR = MINUTE * 60
  const DAY = HOUR * 24
  const WEEK = DAY * 7

  let dateCursor = new Date()

  const repo = await Repository.open(REPO_DIR)
  const client = new elasticsearch.Client({
    host: 'http://elastic:changeme@localhost:9200',
  })

  console.log(`recreating the ${INDEX_NAME} index`)
  await client.indices.delete({ index: INDEX_NAME, ignore: [404] })
  await client.indices.create({
    index: INDEX_NAME,
    body: {
      settings: {
        index: {
          number_of_shards: 1,
          number_of_replicas: 0,
          refresh_interval: '30s',
          highlight: {
            max_analyzed_offset: 100000000,
          },
        },
        analysis: {
          analyzer: {
            camel: {
              type: 'pattern',
              pattern:
                '([^\\p{L}\\d]+)|(?<=\\D)(?=\\d)|(?<=\\d)(?=\\D)|(?<=[\\p{L}&&[^\\p{Lu}]])(?=\\p{Lu})|(?<=\\p{Lu})(?=\\p{Lu}[\\p{L}&&[^\\p{Lu}]])',
              term_vector: 'with_positions_offsets',
            },
          },
        },
      },
      mappings: {
        [TYPE_NAME]: {
          properties: {
            path: {
              type: 'keyword',
            },
            directories: {
              type: 'keyword',
            },
            filename: {
              type: 'keyword',
            },
            extension: {
              type: 'keyword',
            },
            commit: {
              type: 'keyword',
            },
            additions: {
              type: 'text',
              analyzer: 'standard',
            },
          },
        },
      },
    },
  })

  const head = await repo.getBranchCommit('master')
  const readQueue = [head]
  const writeQueue = []
  while (readQueue.length) {
    const commit = readQueue.shift()
    const sha = commit.toString()
    const date = commit.date()

    if (dateCursor.getTime() - date.getTime() > WEEK) {
      dateCursor = date
      console.log(dateCursor.toISOString())
    }

    const [diffs, parents] = await Promise.all([
      commit.getDiff(),
      commit.getParents(10),
    ])

    readQueue.push(...parents)

    for (const diff of diffs) {
      const docsByPath = {}

      for (const patch of await diff.patches()) {
        const path = patch.newFile().path()
        const doc = docsByPath.hasOwnProperty(path)
          ? docsByPath[path]
          : {
              path,
              directories: dirname(path).split(pathSep),
              filename: basename(path),
              extension: extname(path),
              commit: sha,
              additions: '',
            }

        for (const hunk of await patch.hunks()) {
          for (const line of await hunk.lines()) {
            if (line.origin() === GIT_DIFF_LINE_ADDITION) {
              doc.additions += line.content()
            }
          }
        }

        if (doc.additions) {
          docsByPath[doc.path] = doc
        }
      }

      for (const doc of Object.values(docsByPath)) {
        writeQueue.push(
          { index: { _id: doc.path + ':' + doc.commit } },
          doc,
        )
      }
    }

    if (writeQueue.length >= 100) {
      const body = writeQueue.splice(0)
      const resp = await client.bulk({
        index: INDEX_NAME,
        type: TYPE_NAME,
        body,
      })

      if (resp.errors) {
        console.log('')
        console.log('')
        console.log('RESPONSE ERRORS:', resp)
        console.log('')
        console.log('')
        writeQueue.push(...body)
      }
    }
  }
}

main().catch(error => {
  console.error('FATAL ERROR')
  console.error(error.stack)
  process.exit(1)
})
