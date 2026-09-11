# frozen_string_literal: true

module AlmaSketchupMCP
  extend self

  def add_demo_room(entities, operation)
    width = positive_number(operation['width'], 4500, 'room.width')
    depth = positive_number(operation['depth'], 3000, 'room.depth')
    height = positive_number(operation['height'], 2400, 'room.height')
    wall_thickness = positive_number(operation['wall_thickness'] || operation['wallThickness'], 120, 'room.wall_thickness')
    floor_thickness = positive_number(operation['floor_thickness'] || operation['floorThickness'], 100, 'room.floor_thickness')
    name = operation['name'] || 'Demo_Room'

    ensure_material('Floor_Oak', '#a87945')
    ensure_material('Wall_Paint', '#efe7dc')
    ensure_material('Door_Wood', '#7a4a2b')
    ensure_material('Window_Glass', '#8ecae6')
    ensure_material('Table_Wood', '#9b6b43')
    ensure_material('Chair_Fabric', '#315c8a')

    add_box(entities, 'name' => "#{name}_Floor", 'origin' => [0, 0, 0], 'size' => [width, depth, floor_thickness], 'material' => 'Floor_Oak')

    door_width = 900.0
    door_height = 2100.0
    door_x = (width - door_width) / 2.0
    wall_z = floor_thickness

    add_box(entities, 'name' => "#{name}_Wall_South_Left", 'origin' => [0, -wall_thickness, wall_z], 'size' => [door_x, wall_thickness, height], 'material' => 'Wall_Paint')
    add_box(entities, 'name' => "#{name}_Wall_South_Right", 'origin' => [door_x + door_width, -wall_thickness, wall_z], 'size' => [width - door_x - door_width, wall_thickness, height], 'material' => 'Wall_Paint')
    add_box(entities, 'name' => "#{name}_Wall_South_Header", 'origin' => [door_x, -wall_thickness, wall_z + door_height], 'size' => [door_width, wall_thickness, height - door_height], 'material' => 'Wall_Paint')
    add_box(entities, 'name' => "#{name}_Door_Panel", 'origin' => [door_x + 25, -wall_thickness - 25, wall_z], 'size' => [door_width - 50, 25, door_height], 'material' => 'Door_Wood')
    add_box(entities, 'name' => "#{name}_Wall_North", 'origin' => [0, depth, wall_z], 'size' => [width, wall_thickness, height], 'material' => 'Wall_Paint')
    add_box(entities, 'name' => "#{name}_Wall_West", 'origin' => [-wall_thickness, 0, wall_z], 'size' => [wall_thickness, depth, height], 'material' => 'Wall_Paint')
    add_box(entities, 'name' => "#{name}_Wall_East", 'origin' => [width, 0, wall_z], 'size' => [wall_thickness, depth, height], 'material' => 'Wall_Paint')
    add_box(entities, 'name' => "#{name}_Window_North_Glass", 'origin' => [width * 0.58, depth + wall_thickness + 6, wall_z + 1050], 'size' => [1050, 12, 750], 'material' => 'Window_Glass')

    table_x = width / 2.0 - 600
    table_y = depth / 2.0 - 400
    add_box(entities, 'name' => "#{name}_Table_Top", 'origin' => [table_x, table_y, 750], 'size' => [1200, 800, 75], 'material' => 'Table_Wood')
    [[0, 0], [1100, 0], [0, 700], [1100, 700]].each_with_index do |leg, index|
      add_box(entities, 'name' => "#{name}_Table_Leg_#{index + 1}", 'origin' => [table_x + leg[0], table_y + leg[1], 100], 'size' => [100, 100, 650], 'material' => 'Table_Wood')
    end
    add_box(entities, 'name' => "#{name}_Chair_Seat", 'origin' => [table_x + 300, table_y - 550, 450], 'size' => [600, 500, 75], 'material' => 'Chair_Fabric')
    add_box(entities, 'name' => "#{name}_Chair_Back", 'origin' => [table_x + 300, table_y - 600, 525], 'size' => [600, 75, 700], 'material' => 'Chair_Fabric')
    add_box(entities, 'name' => "#{name}_Chair_Leg_1", 'origin' => [table_x + 350, table_y - 500, 100], 'size' => [75, 75, 350], 'material' => 'Chair_Fabric')
    add_box(entities, 'name' => "#{name}_Chair_Leg_2", 'origin' => [table_x + 775, table_y - 500, 100], 'size' => [75, 75, 350], 'material' => 'Chair_Fabric')
    add_box(entities, 'name' => "#{name}_Chair_Leg_3", 'origin' => [table_x + 350, table_y - 150, 100], 'size' => [75, 75, 350], 'material' => 'Chair_Fabric')
    add_box(entities, 'name' => "#{name}_Chair_Leg_4", 'origin' => [table_x + 775, table_y - 150, 100], 'size' => [75, 75, 350], 'material' => 'Chair_Fabric')

    add_warning('info.limitation', 'info', 'Door opening is represented by segmented wall boxes in the MVP DSL.', 'demo_room')
    add_warning('info.limitation', 'info', 'Window is represented as glass marker geometry; true boolean wall cuts are left for refinement.', 'demo_room')
  end
end
