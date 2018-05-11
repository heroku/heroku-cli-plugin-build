import * as stream from 'stream'

export default class LineTransform extends stream.Transform {
  private _lastLineData?: string

  constructor(options: stream.TransformOptions = {}) {
    super({...options, decodeStrings: false})
  }

  _flush(done: stream.TransformCallback) {
    if (this._lastLineData) this.push(this._lastLineData)
    delete this._lastLineData
    done()
  }

  _transform(chunk: string, _: string, next: stream.TransformCallback) {
    let data = chunk
    if (this._lastLineData) data = this._lastLineData + data

    let lines = data.split('\n')
    this._lastLineData = lines.splice(lines.length - 1, 1)[0]

    lines.forEach(this.push.bind(this))
    next()
  }
}
