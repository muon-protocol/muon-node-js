const { callMuon } = require('./helpers')

describe('Gateway test', () => {
  afterAll(async () => {})

  it('should error for unknown app', async () => {
    let { success, error } = await callMuon({
      app: 'unknown-app',
      method: 'bla-bla'
    })
    expect(success).toBe(false)
    expect(error.includes('not defined')).toBe(true)
  })
  it('should error for unknown app method', async () => {
    let { success, error } = await callMuon({ app: 'eth', method: 'bla-bla' })
    expect(success).toBe(false)
    expect(error.includes('Unknown method')).toBe(true)
  })

  it('sample["test_speed"] should work', async () => {
    // expect(sum(1, 2)).toBe(3);
    let { success, result } = await callMuon({
      app: 'sample',
      method: 'test_speed'
    })
    expect(success).toBe(true)
    expect(result.confirmed).toBe(true)
  })
})
