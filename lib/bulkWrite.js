const SECOND = 1000 * 60
exports.bulkWrite = async function(client, queue, index, type) {
  while (queue.length >= 350) {
    const body = queue.splice(0, 350)
    const resp = await client.bulk({
      index,
      type,
      body,
    })

    if (resp.errors) {
      console.log('')
      console.log('')
      console.log('RESPONSE ERRORS')
      console.log('index:', index)
      console.log(resp)
      console.log('')
      console.log('')
      queue.push(...body)
      await new Promise(resolve => setTimeout(resolve, 10 * SECOND))
    }
  }
}
