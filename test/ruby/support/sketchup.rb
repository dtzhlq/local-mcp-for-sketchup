# frozen_string_literal: true

# Minimal load-time SketchUp API surface for isolated Ruby bridge unit tests.
# Runtime behavior is supplied by explicit fakes in each test; this file must
# never be packaged with the plugin.
module Sketchup
  class AppObserver; end
  class Group; end
  class ComponentInstance; end
  class Face; end
  class Edge; end
  class Color; end

  class Material
    COLORIZE_SHIFT = 0
    COLORIZE_TINT = 1
    WORKFLOW_CLASSIC = 0
    WORKFLOW_PBR_METALLIC_ROUGHNESS = 1
    NORMAL_STYLE_OPENGL = 0
    NORMAL_STYLE_DIRECTX = 1
  end

  def self.version
    'fake-sketchup'
  end
end

module UI; end

def file_loaded?(_path)
  true
end

def file_loaded(_path)
  true
end
