# frozen_string_literal: true

require 'fileutils'
require 'json'
require 'securerandom'
require 'time'
require 'tmpdir'

module UI
  class << self
    attr_reader :start_calls, :stop_calls, :timers

    def reset!
      @start_calls = 0
      @stop_calls = 0
      @next_timer_id = 0
      @timers = {}
    end

    def start_timer(interval, repeat, &callback)
      raise 'unexpected timer interval' unless interval == 1.0 && repeat == true

      @start_calls += 1
      @next_timer_id += 1
      @timers[@next_timer_id] = callback
      @next_timer_id
    end

    def stop_timer(timer_id)
      @stop_calls += 1
      @timers.delete(timer_id)
    end

    def messagebox(*)
      raise 'bridge lifecycle must not use modal messagebox feedback'
    end
  end
end

module Sketchup
  class << self
    attr_accessor :status_text
  end
end

plugin_path = File.expand_path('../../sketchup_plugin/local_mcp_for_sketchup/bridge.rb', __dir__)
source = File.read(plugin_path)
start_at = source.index("  def start\n")
processing_at = source.index("  def process_pending_requests\n", start_at)
raise 'missing lifecycle method source' unless start_at && processing_at && processing_at > start_at

LifecycleHarness = Module.new do
  extend self

  def install_document_activation_observer
    @observer_installs = (@observer_installs || 0) + 1
  end

  def process_pending_requests; end
end

root = Dir.mktmpdir('local-mcp-bridge-lifecycle-')
begin
LifecycleHarness.const_set(:QUEUE_DIR, File.join(root, 'queue'))
LifecycleHarness.const_set(:PROCESSING_DIR, File.join(root, 'processing'))
LifecycleHarness.const_set(:RESPONSE_DIR, File.join(root, 'responses'))
LifecycleHarness.module_eval(source.slice(start_at...processing_at), plugin_path, source[0...start_at].count("\n") + 1)

def check!(condition, message)
  raise message unless condition
end

tests = 0
UI.reset!

first_timer = LifecycleHarness.start
first_session = LifecycleHarness.instance_variable_get(:@session_id)
first_started_at = LifecycleHarness.instance_variable_get(:@session_started_at)
tests += 1; check!(first_timer == 1, 'first Start must return the installed timer id')
tests += 1; check!(UI.start_calls == 1 && UI.stop_calls.zero?, 'first Start must install exactly one timer')
tests += 1; check!(LifecycleHarness.instance_variable_get(:@observer_installs) == 1, 'observer must install once')
tests += 1; check!([LifecycleHarness::QUEUE_DIR, LifecycleHarness::PROCESSING_DIR, LifecycleHarness::RESPONSE_DIR].all? { |item| Dir.exist?(item) }, 'state directories must exist')
tests += 1; check!(Sketchup.status_text.end_with?('is running.'), 'running feedback must use status_text')

second_timer = LifecycleHarness.start
tests += 1; check!(second_timer == first_timer, 'repeated Start must preserve the timer id')
tests += 1; check!(UI.start_calls == 1 && UI.stop_calls.zero?, 'repeated Start must not replace or stop the timer')
tests += 1; check!(LifecycleHarness.instance_variable_get(:@session_id) == first_session, 'repeated Start must preserve session_id')
tests += 1; check!(LifecycleHarness.instance_variable_get(:@session_started_at) == first_started_at, 'repeated Start must preserve session_started_at')
tests += 1; check!(LifecycleHarness.instance_variable_get(:@observer_installs) == 1, 'repeated Start must not reinstall observer')
tests += 1; check!(Sketchup.status_text.end_with?('is already running.'), 'repeated Start must give non-modal status')

LifecycleHarness.stop
tests += 1; check!(UI.stop_calls == 1 && UI.timers.empty?, 'Stop must release the timer exactly once')
tests += 1; check!(Sketchup.status_text.end_with?('stopped.'), 'Stop feedback must use status_text')
LifecycleHarness.stop
tests += 1; check!(UI.stop_calls == 1, 'repeated Stop must be idempotent')

puts JSON.generate({
  ok: true,
  tests: tests,
  start_idempotent: true,
  session_preserved_on_repeated_start: true,
  stop_idempotent: true,
  modal_feedback: false
})
ensure
  FileUtils.remove_entry(root) if root && Dir.exist?(root)
end
