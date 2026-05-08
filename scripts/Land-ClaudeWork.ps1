# Land-ClaudeWork.ps1
#
# Wraps the helper-branch + merge + cleanup sequence Claude Code uses
# to land work that the sandbox can't push directly to a long-lived
# branch. Replaces a four-step ritual with one command.
#
# Usage (from inside your local Procela repo):
#   . .\Land-ClaudeWork.ps1                      # dot-source into the current shell
#   Land-ClaudeWork claude/picker-batch-3        # land that branch onto create-procela-development
#   Land-ClaudeWork claude/something-else -Target main   # different target
#
# Or add the function to your PowerShell profile so it's always available:
#   notepad $PROFILE
#   # paste the function body
#
# What it does:
#   1. Confirms you're on the target branch (default create-procela-development)
#      and the working tree is clean.
#   2. git pull --ff-only origin <target>
#   3. git fetch origin <helper>:refs/remotes/origin/<helper>
#   4. git merge --ff-only origin/<helper>
#   5. git push origin <target>
#   6. git push origin --delete <helper>
#   7. git branch -rd origin/<helper>     (clean up local tracking ref)

function Land-ClaudeWork {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true, Position = 0)]
        [string]$Branch,

        [string]$Target = 'create-procela-development'
    )

    # Must be inside a git repo
    $repoTop = git rev-parse --show-toplevel 2>$null
    if (-not $repoTop) {
        Write-Error "Not inside a git repository."
        return
    }

    # Working tree must be clean — never run this with uncommitted edits
    $dirty = git status --porcelain
    if ($dirty) {
        Write-Error "Working tree has uncommitted changes. Commit or stash before landing."
        return
    }

    # Make sure we're on the target branch
    $current = (git rev-parse --abbrev-ref HEAD).Trim()
    if ($current -ne $Target) {
        Write-Host "→ Switching from '$current' to '$Target'..." -ForegroundColor Cyan
        git checkout $Target
        if ($LASTEXITCODE -ne 0) { return }
    }

    Write-Host "→ Pulling latest $Target..." -ForegroundColor Cyan
    git pull --ff-only origin $Target
    if ($LASTEXITCODE -ne 0) { Write-Error "Pull failed."; return }

    Write-Host "→ Fetching helper branch '$Branch'..." -ForegroundColor Cyan
    git fetch origin "${Branch}:refs/remotes/origin/$Branch"
    if ($LASTEXITCODE -ne 0) { Write-Error "Fetch of '$Branch' failed — does it exist on origin?"; return }

    Write-Host "→ Merging origin/$Branch into $Target..." -ForegroundColor Cyan
    git merge --ff-only "origin/$Branch"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Merge is not a fast-forward — local '$Target' has diverged. Resolve manually."
        return
    }

    Write-Host "→ Pushing $Target..." -ForegroundColor Cyan
    git push origin $Target
    if ($LASTEXITCODE -ne 0) { Write-Error "Push of '$Target' failed."; return }

    Write-Host "→ Deleting '$Branch' on origin..." -ForegroundColor Cyan
    git push origin --delete $Branch
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Could not delete '$Branch' on origin (probably already gone)."
    }

    # Drop the local tracking ref so git branch -r stays tidy
    git branch -rd "origin/$Branch" 2>$null | Out-Null

    Write-Host "✓ Landed $Branch onto $Target." -ForegroundColor Green
}
