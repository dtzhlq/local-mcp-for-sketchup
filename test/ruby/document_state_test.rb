# frozen_string_literal: true

require 'json'
require 'time'

module Sketchup
  class AppObserver; end

  class << self
    attr_accessor :active_model

    def add_observer(observer)
      @observer = observer
      true
    end

    attr_reader :observer
  end
end

class FakeModel
  attr_reader :guid, :entities, :pages
  attr_accessor :path

  def initialize(guid:, path: nil, attributes: nil, pages: [])
    @guid = guid
    @path = path
    @entities = []
    @pages = pages
    @attributes = attributes ? Marshal.load(Marshal.dump(attributes)) : {}
  end

  def start_operation(*); end

  def valid?
    true
  end

  def get_attribute(dictionary, key)
    @attributes.dig(dictionary, key)
  end

  def set_attribute(dictionary, key, value)
    (@attributes[dictionary] ||= {})[key] = value
  end

  def saved_attributes
    Marshal.load(Marshal.dump(@attributes))
  end
end

FakePage = Struct.new(:name, :camera, :transition_time) do
  def use_camera?
    true
  end
end

require_relative '../../sketchup_plugin/local_mcp_for_sketchup/document_state'

def LocalMcpForSketchUp.camera_snapshot(camera)
  { 'fake_camera' => camera.to_s }
end

def assert_equal(expected, actual, message)
  raise "#{message}: expected #{expected.inspect}, got #{actual.inspect}" unless expected == actual
end

def assert_truthy(value, message)
  raise message unless value
end

first = FakeModel.new(guid: 'first-guid', path: '/tmp/first.skp')
second = FakeModel.new(guid: 'second-guid', path: '/tmp/second.skp')
Sketchup.active_model = first

first_state = LocalMcpForSketchUp.document_state(first)
first_state['scenes'] << { 'name' => 'First Scene' }
first_state['levels'] << { 'name' => 'First Level', 'elevation' => 0 }
first_state['view_state'] = { 'scene' => 'First Scene' }
LocalMcpForSketchUp.persist_document_state(first)

second_state = LocalMcpForSketchUp.document_state(second)
second_state['scenes'] << { 'name' => 'Second Scene' }
second_state['style_state'] = { 'name' => 'Second Style' }
LocalMcpForSketchUp.persist_document_state(second)

assert_equal(['First Scene'], LocalMcpForSketchUp.document_state(first)['scenes'].map { |scene| scene['name'] }, 'first document scenes must remain isolated')
assert_equal(['Second Scene'], LocalMcpForSketchUp.document_state(second)['scenes'].map { |scene| scene['name'] }, 'second document scenes must remain isolated')
assert_equal(nil, LocalMcpForSketchUp.document_state(first)['style_state'], 'second document style must not leak into first')

reopened_first = FakeModel.new(
  guid: 'reopened-first-guid',
  path: '/tmp/first.skp',
  attributes: first.saved_attributes
)
reopened_state = LocalMcpForSketchUp.document_state(reopened_first)
assert_equal(['First Scene'], reopened_state['scenes'].map { |scene| scene['name'] }, 'new Model object must restore persisted scenes')
assert_equal('First Scene', reopened_state.dig('view_state', 'scene'), 'new Model object must restore persisted view state')
assert_equal(['First Level'], reopened_state['levels'].map { |level| level['name'] }, 'new Model object must restore persisted levels')

page_truth_model = FakeModel.new(
  guid: 'page-truth-guid',
  attributes: first.saved_attributes,
  pages: [FakePage.new('Actual Target Scene', 'target-camera', 0.5)]
)
page_truth_scenes = LocalMcpForSketchUp.snapshot_scenes(page_truth_model)
assert_equal(['Actual Target Scene'], page_truth_scenes.map { |scene| scene['name'] }, 'actual SketchUp pages must reject stale sidecar scene names')

LocalMcpForSketchUp.record_activated_model(second)
assert_equal(first, LocalMcpForSketchUp.queue_active_model, 'focused Sketchup.active_model must replace a stale observer hint')
Sketchup.active_model = second
assert_equal(second, LocalMcpForSketchUp.queue_active_model, 'queue routing must follow a live MDI focus switch in either direction')
LocalMcpForSketchUp.instance_variable_set(:@queue_request_model, first)
assert_equal(first, LocalMcpForSketchUp.queue_active_model, 'a queue request must keep one latched model for guard and operation consistency')
LocalMcpForSketchUp.instance_variable_set(:@queue_request_model, nil)
LocalMcpForSketchUp.forget_document_model(second)
Sketchup.active_model = first
assert_equal(first, LocalMcpForSketchUp.queue_active_model, 'closed observed model must fall back to Sketchup.active_model')

corrupt = FakeModel.new(guid: 'corrupt-guid')
corrupt.set_attribute('LocalMcpForSketchUp', 'document_state_v1', '{not-json')
corrupt_state = LocalMcpForSketchUp.document_state(corrupt)
assert_truthy(corrupt_state['warnings'].any? { |warning| warning['type'] == 'state.sidecar_invalid' }, 'corrupt sidecar must fail closed with a structured warning')

Sketchup.active_model = reopened_first
observer = LocalMcpForSketchUp.install_document_activation_observer
assert_truthy(observer.is_a?(LocalMcpForSketchUp::DocumentActivationObserver), 'document activation observer must install')
assert_equal(observer, Sketchup.observer, 'observer must register with Sketchup')

puts JSON.generate({ ok: true, tests: 14, persistence: true, isolation: true, observer_routing: true, mdi_reconciliation: true, request_latching: true, page_truth: true })
