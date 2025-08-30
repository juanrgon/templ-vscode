import * as vscode from "vscode";
import fs from "fs";

export class TemplGoDefinitionProvider implements vscode.DefinitionProvider {
  private isRecursing = false;

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Definition | vscode.LocationLink[] | null | undefined> {
    if (this.isRecursing) {
      return null;
    }

    this.isRecursing = true;

    try {
      const definitions = await this.getDefinitions(document, position);
      if (!definitions) return null;

      // Check each definition to see if any point to _templ.go files
      for (const definition of definitions) {
        if (this.isTemplGoFile(definition.uri.fsPath)) {
          const templFilePath = this.deriveTemplFilePath(definition.uri.fsPath);
          if (fs.existsSync(templFilePath)) {
            const templResult = await this.handleTemplFile(
              templFilePath,
              document,
              position,
              definitions,
            );
            if (templResult) {
              // Return only the .templ file location, not the _templ.go file
              return templResult;
            }
          }
        }
      }

      // If no _templ.go files were found, return the original definitions
      return definitions;
    } finally {
      this.isRecursing = false;
    }
  }

  private async getDefinitions(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Location[] | null> {
    const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      document.uri,
      position,
    );

    if (!definitions || definitions.length === 0) {
      return null;
    }

    return definitions;
  }

  private isTemplGoFile(filePath: string): boolean {
    return filePath.endsWith("_templ.go");
  }

  private deriveTemplFilePath(goFilePath: string): string {
    return goFilePath.replace(/_templ\.go$/, ".templ");
  }

  private async handleTemplFile(
    templFilePath: string,
    document: vscode.TextDocument,
    position: vscode.Position,
    definitions: vscode.Location[],
  ): Promise<vscode.Definition | vscode.LocationLink[] | null | undefined> {
    try {
      const templDoc =
        await vscode.workspace.openTextDocument(templFilePath);
      const functionName = this.extractFunctionName(document, position);
      const match = this.findTemplFunction(templDoc.getText(), functionName);

      if (match) {
        const positionInTempl = templDoc.positionAt(match.index + 6);
        return [
          new vscode.Location(
            templDoc.uri,
            new vscode.Position(positionInTempl.line, positionInTempl.character),
          ),
        ];
      } else {
        return definitions;
      }
    } catch (error: any) {
      return definitions;
    }
  }

  private findTemplFunction(
    templText: string,
    functionName: string,
  ): RegExpExecArray | null {
    const regex = new RegExp(
      `^templ\\s+${this.escapeRegExp(functionName)}\\b`,
      "m",
    );
    return regex.exec(templText);
  }

  private extractFunctionName(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): string {
    const wordRange =
      document.getWordRangeAtPosition(position) ||
      new vscode.Range(position, position);
    return document.getText(wordRange).trim();
  }

  private escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}