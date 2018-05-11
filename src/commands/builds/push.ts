import color from '@heroku-cli/color'
import {Command, flags} from '@heroku-cli/command'
import ux from 'cli-ux'
import * as execa from 'execa'

import LineTransform from '../../line_transform'

export default class Push extends Command {
  static aliases = ['push']
  static description = 'deploy code to Heroku'
  static hidden = true

  static flags = {
    help: flags.help({char: 'h'}),
    branch: flags.string({char: 'b', description: 'local branch to push', default: 'master', required: true}),
    verbose: flags.boolean({char: 'v', description: 'show full build output'}),
  }

  async run() {
    if (this.config.channel === 'stable') this.error('heroku push is only available on beta')
    const {flags} = this.parse(Push)
    if (!this.heroku.auth) await this.heroku.login()
    if (await this.dirty()) {
      this.warn(`dirty working tree\nSome files have been modified that are not committed to the git repository. See details with ${color.cmd('git status')}`)
    }

    await this.push(flags)
  }

  private async push({branch, verbose}: {branch: string, verbose: boolean}) {
    const auth = this.heroku.auth
    if (!auth) return this.error('not logged in')
    this.debug('git %o', ['-c', 'credential.https://git.heroku.com.helper=! heroku git:credentials', 'push', 'heroku', `${branch}:master`])
    const cmd = execa('git', ['-c', 'credential.https://git.heroku.com.helper=! heroku git:credentials', 'push', 'heroku', `${branch}:master`], {
      stdio: [0, 1, 'pipe'],
      encoding: 'utf8',
    })
    cmd.stderr.setEncoding('utf8')
    let header = ''
    let body = ''
    let recordError = true
    cmd.stderr.pipe(new LineTransform()).on('data', (d: string) => {
      this.debug(d)
      if (d === 'Everything up-to-date') {
        this.log(d)
        this.warn(`No changes to push.
To create a new release, make a change to the repository, stage them with ${color.cmd('git add FILE')} and commit them with ${color.cmd('git commit -m "modified FILE"')}. Then push again with ${color.cmd('heroku push')}
To create an empty release with no changes, use ${color.cmd('git commit --allow-empty')}`)
        return
      }
      d = d.replace(/^remote: /, '')
      if (verbose) {
        this.log(d)
        return
      }
      d = d.trim()
      if (d.startsWith('----->')) {
        header = d.slice(7).trim().replace(/\.\.\.$/, '')
        if (header === 'Build failed') {
          ux.action.stop(color.red.bold(`! ${header}`))
          return
        }
        ux.action.stop()
        ux.action.start(header)
        body = ''
        return
      }
      // hide output after this message
      if (d.match(/! {5}Push (rejected|failed)/)) recordError = false
      if (recordError) body += d + '\n'
      ux.action.status = d
    }).setEncoding('utf8')
    try {
      await cmd
    } catch (err) {
      if (!err.failed || !err.code) throw err
      this.error(body.trim() || 'Build failed')
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
