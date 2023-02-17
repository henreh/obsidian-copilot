import {
    ViewUpdate,
    PluginValue,
    EditorView,
    ViewPlugin,
    DecorationSet,
    Decoration,
    WidgetType
  } from "@codemirror/view";
import { StateEffect } from "@codemirror/state"
import { Notice } from "obsidian";
import OCP from "main";
import { resolve_tfile } from "utils";

function addMenuItem(ul: HTMLUListElement, text: string, id: string) {
    let li = ul.appendChild(document.createElement("li"))
    li.className = "copilot-menu-item";
    li.setAttribute("data-id", id);
    li.appendChild(document.createTextNode(text))
}

function getMenuStateHTML(copilotView: CopilotView) {
    let wrap = document.createElement("div")
    let header = wrap.appendChild(document.createElement("h2"))
    header.className = "copilot-header";
    header.innerText = "Copilot Actions";

    let ul = wrap.appendChild(document.createElement("ul"))
    ul.className = "copilot-menu";

    console.log(ul);
    addMenuItem(ul, "Rewrite to be clearer", "clearer")
    addMenuItem(ul, "Improve explanation", "improve-explanation")
    addMenuItem(ul, "How might we...", "how-might-we")
    addMenuItem(ul, "Pseudo-code decompose", "algorithmic-thinking")
    addMenuItem(ul, "Decompose", "decompose")
    addMenuItem(ul, "Risk assess", "risk-assess")
    addMenuItem(ul, "Tidy", "tidy")
    addMenuItem(ul, "Continue", "continue")

    return wrap;
}

function getOptionsStateHTML(copilotView: CopilotView) {
    let wrap = document.createElement("div")
    let header = wrap.appendChild(document.createElement("h2"))
    header.className = "copilot-header";
    header.innerText = "Copilot Suggestions";

    let ul = wrap.appendChild(document.createElement("ul"))
    ul.className = "copilot-menu";

    //For each suggestion in copilotView.suggestions
    for (let i = 0; i < copilotView.suggestions.length; i++) {
        let li = ul.appendChild(document.createElement("li"))
        li.className = "copilot-menu-item";

        let checkbox = li.appendChild(document.createElement("input"))
        checkbox.type = "checkbox";
        checkbox.className = "copilot-checkbox";
        checkbox.setAttribute("data-suggestion", copilotView.suggestions[i])
        //If first item, check it
        if (i == 0) {
            checkbox.checked = true;
        }

        li.appendChild(document.createTextNode(copilotView.suggestions[i]))
    }

    let footer = wrap.appendChild(document.createElement("div"))
    footer.className = "copilot-footer";

    //Create two buttons: append and replace
    let appendButton = footer.appendChild(document.createElement("button"))
    appendButton.className = "copilot-button";
    appendButton.appendChild(document.createTextNode("Append"))

    let replaceButton = footer.appendChild(document.createElement("button"))
    replaceButton.className = "copilot-button";
    replaceButton.appendChild(document.createTextNode("Replace"))

    return wrap;
}

class TextCopilotWidget extends WidgetType {
    state: string; // "menu", "options"
    copilotView: CopilotView;

    constructor(copilotView: CopilotView) { super(); this.copilotView = copilotView;  }
  
    toDOM() {
      let wrap = document.createElement("div")
      wrap.setAttribute("aria-hidden", "true")
      wrap.className = "copilot-card"
      
      if (this.copilotView.state == "menu") {
        wrap.appendChild(getMenuStateHTML(this.copilotView))
      }

      if (this.copilotView.state == "options") {
        wrap.appendChild(getOptionsStateHTML(this.copilotView))
      }

      return wrap
    }
  
    ignoreEvent() { return false }
}

function copilotWidget(view: EditorView, copilotView: CopilotView) {
    let widgets = [];

    //Get selection
    let selection = view.state.selection.main

    if (selection && (selection.from < selection.to)) 
    {
        //Decoration
        let deco = Decoration.widget({
            widget: new TextCopilotWidget(copilotView),
            side: 1,
        });
        widgets.push(deco.range(selection.to))
    }

    return Decoration.set(widgets);
}


class CopilotView implements PluginValue {
    decorations: DecorationSet;
    state: string;
    currSelection: any;
    copilotPlugin: OCP;
    suggestions: any;

    constructor(view: EditorView) {
        console.log("Copilot view load")
        this.state = "menu"
        this.decorations = copilotWidget(view, this);
    }

    setCopilotPlugin(copilotPlugin: OCP) {
        console.log("SET COPILLOT PLUGIN");
        this.copilotPlugin = copilotPlugin;
    }
  
    update(update: ViewUpdate) {
        if (update.selectionSet)
        {
            //If currselection is different from new selection, reset state
            if (this.currSelection && 
                this.currSelection.from != update.state.selection.main.from && 
                this.currSelection.to != update.state.selection.main.to) {
                this.state = "menu"
            }

            this.currSelection = update.state.selection.main; 
            this.decorations = copilotWidget(update.view, this);
        }
    }

    async handleClick(e, view) {
        console.log("Clicked", e)
        if (e.target.classList.contains("copilot-menu-item")) {    
            if (this.state == "menu")
            {
                new Notice("Running prompt");
                let selectionText = view.state.sliceDoc(this.currSelection.from, this.currSelection.to);

                let prompt = ""; 

                //Load prompt file from prompts/{promptFile}
                let promptFile = e.target.getAttribute("data-id");
                const adapter = this.copilotPlugin.app.vault.adapter
                const promptFileContents = await adapter.read(this.copilotPlugin.manifest.dir + '/prompts/' + promptFile);
                console.log(promptFileContents)

                //prompt = promptFileContents with {selection} replaced with selectionText
                prompt = promptFileContents.replace("{selection}", selectionText);

                let result = await this.copilotPlugin.runPrompt(
                    prompt,
                    {},
                    {
                        temperature: 0.3,
                        max_tokens: 500,
                    }
                );

                let results_split = result.split("\n")

                // go thourgh each result and add to this.suggestions if not empty after trimming
                this.suggestions = []
                for (let i = 0; i < results_split.length; i++) {
                    if (results_split[i].trim() != "") {
                        this.suggestions.push(results_split[i].trim())
                    }
                }


                this.state = "options"
                new Notice("Done!"); 
                this.decorations = copilotWidget(view, this);
                view.dispatch({});
                return; 
            }

            if (this.state == "options")
            {
                new Notice(e.target.innerText);
                return; 
            }
        }

        if (e.target.classList.contains("copilot-button")) {

            let selectedSuggestions = [];
            let checkboxes = document.getElementsByClassName("copilot-checkbox");

            for (let i = 0; i < checkboxes.length; i++) {
                if (checkboxes[i].checked) {
                    selectedSuggestions.push(checkboxes[i].getAttribute("data-suggestion"));
                }
            }

            let change = {};
            if (e.target.innerText == "Append") {
                let addText = "\n - " + selectedSuggestions.join("\n - ");
                change = { from: this.currSelection.to, insert: addText}
            }

            if (e.target.innerText == "Replace") {
                let replaceText = selectedSuggestions.join("\n");
                change = { from: this.currSelection.from, to: this.currSelection.to, insert: replaceText } 
            }
            view.dispatch({ changes: [change] });

            return; 
        }
    }
  
    destroy() {
      // ...
    }
  }
  
  export const copilotViewPlugin = ViewPlugin.fromClass(CopilotView, { 
    decorations: v => v.decorations,
    eventHandlers: {
        mousedown: (event, view) => {
            console.log("MOUSEDOWN", event, view)
            if (event.target.classList.contains("copilot-menu-item") ||
                event.target.classList.contains("copilot-button") ||
                event.target.classList.contains("copilot-checkbox")) {

                event.preventDefault();
                view.plugin(copilotViewPlugin).handleClick(event, view);
                event.stopPropagation();
                event.codemirrorIgnore = true;

            }
        }
    }
});
  
  