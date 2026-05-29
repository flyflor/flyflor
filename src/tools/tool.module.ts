import { Module } from "../di";
import { MemoryModule } from "../memory";
import { SignalModule } from "../signal";
import { CodeGraphTool, ContextCompactTool, RTKComponent, TaskTool } from "./adapters";
import { ArtifactWriterComponent } from "./artifact-writer.component";
import { EditTool, GlobTool, GrepTool, MultiEditTool, ReadTool, WriteTool } from "./file-tools";
import { GitTool } from "./git-tool";
import { MemoryForgetTool, MemoryRecallTool, MemoryStoreTool } from "./memory-tools";
import { ToolRegistry } from "./registry";
import { ShellTool } from "./shell-tool";

/**
 * Assembles project tool execution services.
 *
 * @usage Runtime imports this module when model-driven tool execution is enabled.
 */
@Module({
  imports: [MemoryModule, SignalModule],
  providers: [
    ArtifactWriterComponent,
    ToolRegistry,
    ReadTool,
    WriteTool,
    EditTool,
    MultiEditTool,
    GlobTool,
    GrepTool,
    ShellTool,
    GitTool,
    MemoryRecallTool,
    MemoryStoreTool,
    MemoryForgetTool,
    ContextCompactTool,
    TaskTool,
    RTKComponent,
    CodeGraphTool,
  ],
  exports: [
    ArtifactWriterComponent,
    ToolRegistry,
    ReadTool,
    WriteTool,
    EditTool,
    MultiEditTool,
    GlobTool,
    GrepTool,
    ShellTool,
    GitTool,
    MemoryRecallTool,
    MemoryStoreTool,
    MemoryForgetTool,
    ContextCompactTool,
    TaskTool,
    RTKComponent,
    CodeGraphTool,
  ],
})
export class ToolModule {}
