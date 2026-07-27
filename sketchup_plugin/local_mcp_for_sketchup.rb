# frozen_string_literal: true

require 'sketchup.rb'
require 'extensions.rb'

module LocalMcpForSketchUp
  PLUGIN_VERSION = '0.1.0-rc.4'
  EXTENSION_NAME = 'Local MCP for SketchUp'
  EXTENSION_CREATOR = 'zhanglinqi'

  unless file_loaded?(__FILE__)
    extension = SketchupExtension.new(EXTENSION_NAME, 'local_mcp_for_sketchup/bridge')
    extension.description = 'Local, offline-capable MCP bridge for reviewed SketchUp modeling workflows.'
    extension.version = PLUGIN_VERSION
    extension.creator = EXTENSION_CREATOR
    extension.copyright = 'Copyright 2026 zhanglinqi'
    Sketchup.register_extension(extension, true)
    file_loaded(__FILE__)
  end
end
