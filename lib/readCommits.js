const { extname, sep: pathSep, dirname, basename } = require('path')

const { Observable } = require('rxjs')
const { Repository } = require('nodegit')

const GIT_DIFF_LINE_ADDITION = '+'.charCodeAt(0)

exports.readCommits = function(repoDir, branch) {
  const commit$ = Observable.create(async observer => {
    try {
      const repo = await Repository.open(repoDir)
      const head = await repo.getBranchCommit(branch)
      const queue = [head]
      const seen = new Set()

      while (queue.length && !observer.closed) {
        const commit = queue.shift()
        const sha = commit.toString()

        if (seen.has(sha)) {
          continue
        } else {
          seen.add(sha)
          observer.next(commit)
        }

        queue.push(...(await commit.getParents(10)))
      }

      observer.complete()
    } catch (error) {
      observer.error(error)
    }
  })

  const code$ = commit$
    .mergeMap(async commit => {
      const codeByPath = {}
      const sha = commit.toString()

      for (const diff of await commit.getDiff()) {
        for (const patch of await diff.patches()) {
          const path = patch.newFile().path()
          const doc = codeByPath.hasOwnProperty(path)
            ? codeByPath[path]
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
            codeByPath[doc.path] = doc
          }
        }
      }

      return Object.values(codeByPath)
    })
    .mergeAll()

  return { commit$, code$ }
}
