import color from '@heroku-cli/color'
import {Command, flags} from '@heroku-cli/command'
import {CLIError} from '@oclif/errors'
import ux from 'cli-ux'
import * as execa from 'execa'

import LineTransform from '../../line_transform'

const currentBranch = execa.sync('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout
const strip = require('strip-ansi')

export default class Push extends Command {
  static aliases = ['push']
  static description = 'deploy code to Heroku'
  static hidden = true

  static flags = {
    app: flags.app({required: true}),
    remote: flags.remote(),
    help: flags.help({char: 'h'}),
    branch: flags.string({char: 'b', description: 'local branch to push', default: 'master', required: true}),
    verbose: flags.boolean({char: 'v', description: 'show full build output'}),
    force: flags.boolean({char: 'f', description: 'force push to overwrite remote branch'}),
  }

  async run() {
    if (this.config.channel === 'stable') this.error('heroku push is only available on beta')
    const {flags} = this.parse(Push)
    if (!this.heroku.auth) await this.heroku.login()
    if (flags.branch === 'master' && currentBranch !== 'master') {
      this.error(`Not on master branch.\nPush ${currentBranch} branch with ${color.cmd('heroku push --branch ' + currentBranch)}`)
    }
    if (flags.branch !== currentBranch) {
      this.warn(`Pushing ${flags.branch} but currently on ${currentBranch}`)
    }
    if (await this.dirty()) {
      this.warn(`dirty working tree\nSome files have been modified that are not committed to the git repository\nSee details with ${color.cmd('git status')}`)
    }

    await this.push(flags)
  }

  private async push({branch, verbose, app, force}: {branch: string, verbose: boolean, app: string, force: boolean}) {
    const auth = this.heroku.auth
    if (!auth) return this.error('not logged in')
    if (verbose) {
      this.log(`Pushing to ${color.app(app)}`)
    } else {
      ux.action.start(`Pushing to ${color.app(app)}`)
    }
    const remote = `https://git.heroku.com/${app}.git`
    const args = ['-c', 'credential.https://git.heroku.com.helper=! heroku git:credentials', 'push', remote, `${branch}:master`]
    if (force) args.push('--force')
    this.debug('git %o', args)
    const cmd = execa('git', args, {
      stdio: [0, 'pipe', 'pipe'],
      encoding: 'utf8',
    })
    cmd.stderr.setEncoding('utf8')
    let header = ''
    let body = ''
    let failed = false
    let done = 'done'
    let error: Error | undefined
    let success = color.green.underline(`https://${app}.herokuapp.com`) + ' deployed to Heroku'
    cmd.stdout.on('data', (d: string) => process.stdout.write(d))
    let stderr = cmd.stderr.pipe(new LineTransform())
    stderr.once('data', (d: string) => {
      if (d === 'Everything up-to-date') {
        this.log(d)
        error = new CLIError(`No changes to push
To create a new release, make a change to the repository, stage them with ${color.cmd('git add FILE')}, commit with ${color.cmd('git commit -m "modified FILE"')}, and push again with ${color.cmd('heroku push')}
To create an empty release with no changes, use ${color.cmd('git commit --allow-empty')}`)
        return
      }
    })
    stderr.on('data', (d: string) => {
      this.debug(d)
      d = d.replace(/^remote: /, '')
      if (verbose) {
        if (d.startsWith('----->')) {
          let [, arrow, header] = d.match(/(----->)(.*)/)!
          let c = color.bold
          if (header.trim() === 'Build failed') {
            body = ''
            failed = true
            c = c.red
          }
          d = c(arrow + header)
        }
        if (d.toLowerCase().match(/^(error|fatal):/)) {
          d = color.red(d)
        }
        let warning = d.match(/^\s*!+\s+(.+)/)
        if (warning) {
          d = warning[1].trim()
          let c = color.yellow
          if (failed) c = color.red
          d = ` ${c.bold('!')}     ${c(d)}`
        }
        this.log(d)
        return
      }
      d = d.replace(new RegExp('\b' as any, 'g'), '')
      let type: 'normal' | 'warning' | 'error' = 'normal'
      if (d.startsWith('\u001b[1;31m ')) {
        type = 'error'
        d = strip(d)
      } else if (d.startsWith('\u001b[1;33m ')) {
        type = 'warning'
        d = strip(d)
      }
      if (d.trimRight() === 'Building source:') {
        d = '-----> Building source'
      }
      if (d.startsWith('----->')) {
        header = d.replace(/^----->/, '').trim().replace(/(…|\.\.\.)$/, '')
        if (header === 'Build failed') {
          failed = true
          ux.action.stop(color.red.bold(`! ${header}`))
          return
        }
        if (header.startsWith('Build succeeded')) {
          this.log(color.green(header))
          return
        }
        if (!failed) body = color.red(header) + '\n'
        ux.action.stop(done || 'done')
        done = 'done'
        ux.action.start(header)
        return
      }
      if (failed) {
        if (d.match(/ ! {5}Push (rejected|failed)/)) {
          failed = false // hide output after this message
          return
        }
        if (d.match(/^\s*!+\s*/)) {
          d = color.red(d.replace(/^\s*!+\s*/, ''))
        }
        if (d.startsWith('       ')) {
          d = d.slice(7)
        }
        body += d + '\n'
        return
      }
      if (d.match(/^(fatal|error):/i)) {
        this.error(d.replace(/^(fatal|error):/i, '').trim(), {exit: false})
        return
      }
      if (d.trim().toLowerCase().startsWith('warning')) {
        if (d.trim() === 'warning Ignored scripts due to flag.') return
        this.warn(d.trim().replace(/^warning:?/i, '').trim())
        return
      }
      if (d.match(/^\s*!+\s*/)) {
        if (type === 'error') {
          this.error(d.replace(/^\s*!+\s*/, '').trim(), {exit: false})
        } else {
          this.warn(d.replace(/^\s*!+\s*/, '').trim())
        }
        return
      }
      if (header === 'Discovering process types') {
        const match = d.trim().match(/^Procfile declares types\s+->\s+(.+)/)
        if (match) done = match[1]
      }
      if (header === 'Installing binaries') {
        const match = d.trim().match(/^Downloading and installing (node \d+\.\d+\.\d+)/)
        if (match) done = match[1]
      }
      if (header === 'Compressing') {
        const match = d.trim().match(/^Done: (.+)/)
        if (match) done = match[1]
      }
      if (header === 'Launching') {
        let match = d.trim().match(/^Released (v\d+)/)
        if (match) done = match[1]
        match = d.trim().match(/^(https:\S+)( deployed to Heroku)/)
        if (match) success = `${color.green.underline(match[1])}${match[2]}`
      }
      let shaOutput = d.trim().match(/[a-f0-9]+\.\.[0-9a-f]+\s+\S+ -> master/)
      if (shaOutput) {
        this.log(d.trim())
        return
      }
      if (d.startsWith('       ')) {
        d = d.slice(7)
      }
      ux.action.status = d.trim()
      body += d + '\n'
    }).setEncoding('utf8')
    try {
      await cmd
      if (error) throw error
    } catch (err) {
      if (!err.failed || !err.code) throw err
      let msg = body.trim() || 'Build failed'
      if (!verbose) msg += `\n\nSee full build output with ${color.cmd('heroku push --verbose')}`
      this.error(msg)
    }
    ux.action.stop(done)
    if (success) this.log(success)
  }

  private async dirty() {
    const status = await this.git(['status', '--porcelain'])
    return status !== ''
  }

  private async git(args: string[]): Promise<string> {
    this.debug('git %o', args)
    try {
      return await execa.stdout('git', args)
    } catch (err) {
      if (err.message.includes('fatal: no upstream configured for branch')) {
        let [, branch] = err.message.match(/fatal: no upstream configured for branch '(.*)'/)
        this.error(`${err.message}\nIf you wish to set tracking information for this branch to origin/${branch} you can do so with:

    git branch --set-upstream-to=origin/${branch} ${branch}
`)
      }
      if (err.message.includes('fatal: not a git repository')) {
        this.error(`Not inside a git repository\nheroku push requires that you are in a git repository.\nCurrent path: ${process.cwd()}`)
      }
      throw err
    }
  }
}
