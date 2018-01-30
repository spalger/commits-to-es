const { resolve } = require('path')

const { Observable } = require('rxjs')
const elasticsearch = require('elasticsearch')

const { readCommits, setupIndex } = require('./lib')

const REPO_DIR = resolve(process.env.REPO_DIR)
const COMMIT_INDEX_NAME = 'commits'
const CODE_INDEX_NAME = 'code'
const TYPE_NAME = 'doc'
const SECOND = 1000

async function main() {
  const client = new elasticsearch.Client({
    host: 'http://elastic:changeme@localhost:9200',
  })

  await Promise.all([
    setupIndex(client, CODE_INDEX_NAME, {
      settings: {
        index: {
          number_of_shards: 1,
          number_of_replicas: 0,
          refresh_interval: '15s',
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
    }),
    setupIndex(client, COMMIT_INDEX_NAME, {
      settings: {
        index: {
          number_of_shards: 1,
          number_of_replicas: 0,
          refresh_interval: '15s',
        },
      },
      mappings: {
        [TYPE_NAME]: {
          properties: {
            message: {
              type: 'text',
            },
          },
        },
      },
    }),
  ])

  const { commit$, code$ } = readCommits(REPO_DIR, 'master')

  const commitReqPair$ = commit$.map(commit => [
    {
      index: {
        _index: COMMIT_INDEX_NAME,
        _type: TYPE_NAME,
        _id: commit.toString(),
      },
    },
    { message: commit.message() },
  ])

  const codeReqPair$ = code$.map(code => [
    {
      index: {
        _index: CODE_INDEX_NAME,
        _type: TYPE_NAME,
        _id: code.path + ':' + code.commit,
      },
    },
    code,
  ])

  // convert pairs to strings so they are easier to count and I don't
  // have to worry about if they get mixed up
  const req$ = await Observable.merge(
    commitReqPair$,
    codeReqPair$,
  ).map(
    ([header, body]) =>
      `${JSON.stringify(header)}\n${JSON.stringify(body)}\n`,
  )

  const finalReport = await req$
    .bufferCount(300)
    .mergeScan(
      async (prev, reqs) => {
        const resp = await client.bulk({
          body: [...reqs, prev.failures].join(''),
        })

        if (resp.errors) {
          console.log('')
          console.log('')
          console.log('RESPONSE ERRORS')
          console.log(resp)
          console.log('')
          console.log('')

          // delay next request a bit
          await new Promise(resolve =>
            setTimeout(resolve, 30 * SECOND),
          )

          return {
            failures: reqs,
            count: prev.count,
          }
        }

        return {
          failures: [],
          count: prev.count + reqs.length,
        }
      },
      { count: 0, failures: [] },
    )
    .sampleTime(5 * SECOND)
    .do(report => console.log('... %d', report.count))
    .toPromise()

  console.log('DONE: %d items indexed', finalReport.count)
}

main().catch(error => {
  console.error('FATAL ERROR')
  console.error(error.stack)
  process.exit(1)
})
