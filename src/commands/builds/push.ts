import color from '@heroku-cli/color'
import {Command, flags} from '@heroku-cli/command'
import * as execa from 'execa'

export default class Push extends Command {
  static aliases = ['push']
  static description = 'deploy code to heroku'

  static flags = {
    help: flags.help({char: 'h'})
  }

  static args = [{name: 'file'}]

  async run() {
    const {args, flags} = this.parse(Push)

    if (await this.dirty()) {
      this.warn(`dirty working tree\nSome files have been modified that are not committed to the git repository. See details with ${color.cmd('git status')}`)
    }
  }

  async dirty() {
    let status = await this.git(['status', '--porcelain'])
    return status !== ''
  }

  async git(args: string[]): Promise<string> {
    this.debug('git %o', args)
    try {
      return await execa.stdout('git', args)
    } catch (err) {
      if (err.message.includes('fatal: no upstream configured for branch')) {
        let [, branch] = err.message.match(/fatal: no upstream configured for branch '(.*)'/)
        this.error(`${err.message}\nIf you wish to set tracking information for this branch to origin/${branch} you can do so with:

    git branch --set-upstream-to=origin/${branch} ${branch}
`)
      } else if (err.message.includes('fatal: not a git repository')) {
        this.error(`Not inside a git repository\nheroku push requires that you are in a git repository.\nCurrent path: ${process.cwd()}`)
      } else throw err
    }
  }
}
