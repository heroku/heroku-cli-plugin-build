import color from '@heroku-cli/color'
import {Command, flags} from '@heroku-cli/command'
import ux from 'cli-ux'
import * as execa from 'execa'

import LineTransform from '../../line_transform'

const currentBranch = execa.sync('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout

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

  private async push({branch, verbose, app}: {branch: string, verbose: boolean, app: string}) {
    const auth = this.heroku.auth
    if (!auth) return this.error('not logged in')
    this.log(`Pushing to ${color.app(app)}`)
    const remote = `https://git.heroku.com/${app}.git`
    this.debug('git %o', ['-c', 'credential.https://git.heroku.com.helper=! heroku git:credentials', 'push', remote, `${branch}:master`])
    const cmd = execa('git', ['-c', 'credential.https://git.heroku.com.helper=! heroku git:credentials', 'push', remote, `${branch}:master`], {
      stdio: [0, 'pipe', 'pipe'],
      encoding: 'utf8',
    })
    cmd.stderr.setEncoding('utf8')
    let header = ''
    let body = ''
    let failed = false
    cmd.stdout.on('data', (d: string) => process.stdout.write(d))
    let stderr = cmd.stderr.pipe(new LineTransform())
    stderr.once('data', (d: string) => {
      if (d === 'Everything up-to-date') {
        this.log(d)
        this.warn(`No changes to push.
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
            failed = true
            c = c.red
          }
          d = c(arrow + header)
        }
        if (d.toLowerCase().match(/^(error|fatal):/)) {
          d = color.red(d)
        }
        let warning = d.match(/^\s*!\s+(.+)/)
        if (warning) {
          d = warning[1].trim()
          let c = color.yellow
          if (failed) c = color.red
          d = ` ${c.bold('!')}     ${c(d)}`
        }
        this.log(d)
        return
      }
      d = d.trim()
      if (d.startsWith('----->')) {
        header = d.slice(7).trim().replace(/\.\.\.$/, '')
        if (header === 'Build failed') {
          failed = true
          ux.action.stop(color.red.bold(`! ${header}`))
          return
        }
        ux.action.stop()
        ux.action.start(header)
        body = ''
        return
      }
      if (failed) {
        if (d.match(/! {5}Push (rejected|failed)/)) {
          failed = false // hide output after this message
          return
        }
        if (d.startsWith('!\s+')) {
          d = color.red(d.replace(/^!\s+/, '').trim())
        }
        body += d.trim() + '\n'
        return
      }
      if (d.match(/(fatal|error):/i)) {
        this.log(color.red(d.trim()))
        return
      }
      if (d.toLowerCase().startsWith('warning')) {
        if (d === 'warning Ignored scripts due to flag.') return
        this.warn(d.replace(/^warning/i, '').trim())
        return
      }
      if (d.match(/^!\s+/)) {
        this.warn(d.replace(/^!\s+/, '').trim())
        return
      }
      ux.action.status = d
    }).setEncoding('utf8')
    try {
      await cmd
    } catch (err) {
      if (!err.failed || !err.code) throw err
      let msg = body.trim() || 'Build failed'
      if (!verbose) msg += `\n\nSee full build output with ${color.cmd('heroku push --verbose')}`
      this.error(msg)
    }
    ux.action.stop()
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
