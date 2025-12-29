import {App, FileSystemAdapter, Notice, Plugin, PluginSettingTab, Setting} from 'obsidian';

import {exec} from 'child_process';

interface GitOnlyAutoCommitPluginSettings {
	intervalMinutes: number;
}

const DEFAULT_SETTINGS: GitOnlyAutoCommitPluginSettings = {
	intervalMinutes: 5
}

export default class GitOnlyAutoCommitPlugin extends Plugin {
	settings: GitOnlyAutoCommitPluginSettings;

	private isRunning = false;
	private autoIntervalHandle: number | null = null;

	async onload() {
		await this.loadSettings();

		this.addRibbonIcon('git-branch', 'Git: Commit & Push', async () => {
			this.commitAndPush().catch(() => { });
		});

		this.addSettingTab(new GitOnlyAutoCommitSettingTab(this.app, this));
		this.reschedule();
		this.commitAndPush().catch(() => { });
	}

	public reschedule() {
		if (this.autoIntervalHandle != null) {
			window.clearInterval(this.autoIntervalHandle);
			this.autoIntervalHandle = null;
		}

		const minutes = Number(this.settings.intervalMinutes);
		if (!isFinite(minutes) || minutes <= 0) {
			return;
		}

		const ms = Math.max(10_000, Math.round(minutes * 60 * 1000));
		this.autoIntervalHandle = window.setInterval(() => {
			if (!this.isRunning) {
				this.commitAndPush().catch(() => { });
			}
		}, ms);

		this.registerInterval(this.autoIntervalHandle);
	}

	private async commitAndPush() {
		if (this.isRunning) {
			new Notice('only commit: already running');
			return;
		}
		this.isRunning = true;

		try {
			const cwd = this.getVaultPath();
			if (!cwd) {
				new Notice('Available on desktop only');
				return;
			}

			await this.run('git rev-parse --is-inside-work-tree', cwd);

			const msg = this.buildCommitMessage();

			await this.run('git add -A', cwd);

			try {
				await this.run(`git commit -m "${msg.replace(/"/g, '\\"')}"`, cwd);
			} catch (e: any) {
				const stdout = (e?.stdout ?? '').toString();
				const stderr = (e?.stderr ?? '').toString();
				const msg = (stderr || stdout || e?.message || String(e)).trim();
				if (!/nothing to commit/i.test(String(msg))) {
					throw e;
				}
			}
			
			await this.run('git push', cwd);
		} catch (e: any) {
			const code = typeof e?.code === 'number' ? e.code : -1;
			const stdout = (e?.stdout ?? '').toString();
			const stderr = (e?.stderr ?? '').toString();
			const msg = (stderr || stdout || e?.message || String(e)).trim();
			new Notice('only commit: Error\n' + msg.slice(0, 400));
			console.error('[GitAutoCommitOnly]', e);
		} finally {
			this.isRunning = false;
		}
	}

	private buildCommitMessage() {
		const d = new Date();
		const MM = d.getMonth() + 1;
		const DD = d.getDate();
		const YYYY = d.getFullYear();
		const hh = d.getHours();
		const mm = d.getMinutes().toString().padStart(2, '0');
		return `auto commit at ${MM}-${DD}-${YYYY} ${hh}:${mm}`;
	}

	private run(command: string, cwd: string): Promise<{ stdout: string; stderr: string }> {
		return new Promise((resolve, reject) => {
			exec(
				command,
				{
					cwd,
					windowsHide: true,
					env: process.env
				},
				(error, stdout, stderr) => {
					if (error) {
						reject({ error, stdout, stderr });
					} else {
						resolve({ stdout, stderr });
					}
				}
			);
		});
	}

	private getVaultPath(): string | null {
		const adapter = this.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			return adapter.getBasePath();
		}
		return null;
	}

	onunload() {
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class GitOnlyAutoCommitSettingTab extends PluginSettingTab {
	plugin: GitOnlyAutoCommitPlugin;

	constructor(app: App, plugin: GitOnlyAutoCommitPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Interval (Minutes)')
			.setDesc('Auto-commit interval in minutes. Decimals allowed. Set 0 to disable.')
			.addText((text) => {
				text
					.setPlaceholder('e.g., 5 or 2.5')
					.setValue(String(this.plugin.settings.intervalMinutes))
					.onChange(async (value) => {
						const n = parseFloat(value);
						this.plugin.settings.intervalMinutes = isFinite(n) && n >= 0 ? n : 0;
						await this.plugin.saveSettings();
						this.plugin.reschedule();
					});

				const input = text.inputEl as HTMLInputElement;
				input.type = 'number';
				input.step = '0.1';
				input.min = '0';
			});
	}
}
