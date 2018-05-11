import color from '@heroku-cli/color'
import {Command, flags} from '@heroku-cli/command'
import * as execa from 'execa'

export default class Push extends Command {
  static aliases = ['push']
  static description = 'deploy code to Heroku'

  static flags = {
    help: flags.help({char: 'h'}),
    branch: flags.string({char: 'b', description: 'local branch to push', default: 'master', required: true}),
  }

  async run() {
    const {flags} = this.parse(Push)
    if (!this.heroku.auth) await this.heroku.login()
    if (await this.dirty()) {
      this.warn(`dirty working tree\nSome files have been modified that are not committed to the git repository. See details with ${color.cmd('git status')}`)
    }

    await this.push(flags.branch)
  }

  private async push(branch: string) {
    const auth = this.heroku.auth
    if (!auth) return this.error('not logged in')
    this.debug('git %o', ['-c', 'credential.https://git.heroku.com.helper=! heroku git:credentials', 'push', 'heroku', `${branch}:master`])
    const cmd = execa('git', ['-c', 'credential.https://git.heroku.com.helper=! heroku git:credentials', 'push', 'heroku', `${branch}:master`], {
      stdio: [0, 'pipe', 2]
    })
    cmd.stdout.on('data', d => {
      console.dir(d)
    })
    await cmd
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
