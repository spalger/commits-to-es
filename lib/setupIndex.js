exports.setupIndex = async function(client, index, body) {
  console.log(`recreating the ${index} index`)

  await client.indices.delete({
    index,
    ignore: [404],
  })

  await client.indices.create({
    index,
    body,
  })
}
