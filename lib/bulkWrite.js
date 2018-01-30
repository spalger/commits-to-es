exports.bulkWrite = async function(client, queue, index, type) {
  if (queue.length >= 100) {
    const body = queue.splice(0)
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
    }
  }
}
