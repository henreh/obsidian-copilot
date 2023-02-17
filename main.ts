import { Menu, App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, FuzzySuggestModal, TFile } from 'obsidian';
import { get_tfiles_from_folder } from "utils";
const { Configuration, OpenAIApi } = require("openai");
import { copilotViewPlugin } from 'CopilotView';

interface OCPSettings {
	prompt_directory: string;
	openai_api_key: string;
	temperature: number;
}

const DEFAULT_SETTINGS: OCPSettings = {
	prompt_directory: '.',
	openai_api_key: '',
	temperature: 0.3
}

class PromptSuggester extends FuzzySuggestModal<TFile> {
	private OCP: OCP;
	public selection: string;

	constructor(plugin: OCP, onChooseItem: (item: TFile) => void) {
		super(app);
		this.OCP = plugin;
		this.setPlaceholder("Type name of a prompt template...");
		this.onChooseItem = onChooseItem;
	}

	getItems(): Tfile[] {
		const files = get_tfiles_from_folder(this.OCP.settings.prompt_directory)
		if (!files) {
			return [];
		}
		return files;
	}    
	
	getItemText(item: TFile): string {
        return item.basename;
    }
}

export default class OCP extends Plugin {
	settings: OCPSettings;
	openai_config: typeof Configuration;
	openai: typeof OpenAIApi;
	showingMenu: boolean;

	makeEdit(editor: Editor, newText: string, oldText: string) {
		const outmarkdown = oldText + "\n" + newText;

		editor.replaceSelection(outmarkdown);
	}

	checkSelection() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view) {
			const editor = view.editor;
			const selection = editor.getSelection();
			if (selection) {
				new Notice("Selection");
				//this.createMenu(editor.getCursor("from"));
			}
		}
	}

	sendPluginReferenceToCopilotView() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view) {
			const editorView = view.editor.cm;
			const plugin = editorView.plugin(copilotViewPlugin);
			plugin.setCopilotPlugin(this);
		}
	}

	async onload() {

		this.showingMenu = false; 

		await this.loadSettings();

		this.registerEditorExtension(copilotViewPlugin);
		this.sendPluginReferenceToCopilotView();

		//Almighty fucking hackjob but we need an active editor window to get the plugin reference and the documentation is terrible
		this.registerInterval(
			window.setInterval(() => this.sendPluginReferenceToCopilotView(), 1000)
		);

		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'run-simple-prompt',
			name: 'Run selection as prompt',
			hotkeys: [{ modifiers: ["Alt"], key: "a" }],
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				const sel = editor.getSelection();
				console.log("Selected text", sel);
				const result = await this.runPrompt(sel);
				console.log("Result", result);
				
				this.makeEdit(editor, result, sel);
			}
		});

		this.addCommand({
			id: 'run-custom-prompt',
			name: 'Run custom prompt',
			hotkeys: [{ modifiers: ["Alt"], key: "d" }],
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				console.log("View", view)
				let tags = this.getPageTags(view.file); 

				//if tags is null, make it an empty object
				if (!tags) {
					tags = {};
				}

				const prompt_suggester = new PromptSuggester(this, async (result) => {
					const contents = await this.app.vault.read(result);
					const promptParameters = this.getPromptParameters(result);
					const completed_prompt = contents.replace("{selection}", editor.getSelection());
					console.log("Completed prompt", completed_prompt);
					console.log("Prompt parameters", promptParameters);

					const completion = await this.runPrompt(completed_prompt, tags, promptParameters);

					console.log("Result", completion);

					this.makeEdit(editor, completion, editor.getSelection());
				}).open();
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new OCPSettings(this.app, this));
	}

	getPageTags(page: TFile) {
		console.log(page)
		console.log(this.app.metadataCache.getFileCache(page))
		const tags = this.app.metadataCache.getFileCache(page)?.frontmatter;
		return tags;
	}

	getPromptParameters(promptFile: TFile) {
		const promptFilematter = this.app.metadataCache.getFileCache(promptFile)?.frontmatter;
		// For each of the OpenAI API parameters, if the prompt file has a corresponding field, use that value. Otherwise, use the default value.
		const promptParameters = {
			temperature: promptFilematter?.temperature || this.settings.temperature,
			max_tokens: promptFilematter?.max_tokens || 150,
			n: promptFilematter?.n || 1,
			presence_penalty: promptFilematter?.presence_penalty || 0,
			frequency_penalty: promptFilematter?.frequency_penalty || 0,
			best_of: promptFilematter?.best_of || 1,
		}
		return promptParameters;
	}

	async runPrompt(prompt: string, promptTags: {}, promptParameters: {}) {
		this.openai_config = new Configuration({
			apiKey: this.settings.openai_api_key
		});

		this.openai = new OpenAIApi(this.openai_config);

		//For each promptTag of the form {key: value}, add a line to the start of the prompt of the form "Using a {key} of {value}.\n"
		for (const tag of Object.keys(promptTags)) {
			if (tag != "position") {
				prompt = `${tag} ${promptTags[tag]}.\n` + prompt;
			}
		}

		prompt += "Format your answer using markdown, using bullet lists where necessary and subheadings to delineate different sections."


		console.log("Running prompt", prompt);
		const response = await this.openai.createCompletion({
			model: 'text-davinci-003',
			prompt: prompt,
			...promptParameters
		});
		console.log("Response", response)
		return response.data.choices[0].text;
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


class OCPSettings extends PluginSettingTab {
	plugin: OCP;

	constructor(app: App, plugin: OCP) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Settings for Obsidian Copilot.'});

		new Setting(containerEl)
			.setName('Prompts directory')
			.setDesc('Where to find prompt markdown files')
			.addText(text => text
				.setPlaceholder('Enter directory for prompts')
				.setValue(this.plugin.settings.prompt_directory)
				.onChange(async (value) => {
					this.plugin.settings.prompt_directory = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('OpenAI API Key')
			.setDesc('API key for OpenAI')
			.addText(text => text
				.setPlaceholder('Enter API key for OpenAI')
				.setValue(this.plugin.settings.openai_api_key)
				.onChange(async (value) => {
					this.plugin.settings.openai_api_key = value;
					await this.plugin.saveSettings();
				}
			));

		new Setting(containerEl)
			.setName('Temperature')
			.setDesc('Temperature for OpenAI')
			.addText(text => text
				.setPlaceholder('Enter temperature for OpenAI')
				.setValue(this.plugin.settings.temperature.toString())
				.onChange(async (value) => {
					this.plugin.settings.temperature = parseFloat(value);
					await this.plugin.saveSettings();
				}	
			));

	}
}
