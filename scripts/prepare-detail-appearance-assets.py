#!/usr/bin/env python3
"""Prepare a local-only catalog from the user's installed SketchUp library.

Copies embedded files without altering images. Does not download or redistribute
vendor content. Outputs are acceptance inputs, never evidence of native application.
"""
import argparse
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET
from zipfile import ZipFile

MATERIALS = {
    'wood': 'Wood/Wood_Veneer_15_1K.skm',
    'stone': 'Stone/Marble_03_1K.skm',
    'tile': 'Tile/Tile_Interior_05_1K.skm',
    'paint': 'Plaster/Plaster_03_1K.skm',
    'metal': 'Metal/Metal_06_1K.skm',
    'glass': 'Glass/Glass_Basic_01.skm',
    'fabric': 'Fabric/Fabric_08_1K.skm',
}
ENVIRONMENTS = {
    'studio': 'Old Warehouse 2K IBL.ske',
    'daylight': 'Sky - Partial Clouds 2K IBL.ske',
}
NS = {'m': 'http://sketchup.google.com/schemas/sketchup/1.0/material'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('xb') as stream:
        stream.write(data)


def prepare(resources, output):
    catalog = {'version': 1, 'assets': [], 'presets': {}, 'environments': {},
               'evidence': 'local_archive_inspection_only',
               'license': 'SketchUp installed library terms; no redistribution license inferred'}
    for kind, relative in MATERIALS.items():
        source = resources / 'Materials' / relative
        with ZipFile(source) as archive:
            tree = ET.fromstring(archive.read('document.xml'))
            material = tree.find('m:material', NS)
            texture = material.find('m:texture', NS)
            pbr = material.find('m:pbrMR', NS)
            preset = {'name': f'Native_{kind.title()}', 'source_skm_path': str(source),
                      'source_sha256': digest(source.read_bytes()), 'pbr': {}}
            preset['source_color'] = '#{:02x}{:02x}{:02x}'.format(*[
                int(material.get(channel, '204')) for channel in ('colorRed', 'colorGreen', 'colorBlue')])
            if material.get('useTrans') == '1':
                preset['alpha'] = float(material.get('trans', '1'))
            def extract(element):
                member = 'ref/' + Path(element.attrib['path']).name
                target = output / kind / Path(member).name
                data = archive.read(member)
                write(target, data)
                return str(target.resolve())
            if texture is not None:
                entry = texture.find('m:images/m:image', NS)
                if entry is not None:
                    preset['texture'] = {'path': extract(entry),
                                         'width': float(texture.get('xScale')) * 25.4,
                                         'height': float(texture.get('yScale')) * 25.4}
            if pbr is not None:
                for xml_name, key in [('metallicFactor', 'metallic_factor'), ('roughnessFactor', 'roughness_factor'),
                                      ('normalScale', 'normal_scale'), ('occlusionStrength', 'ao_strength')]:
                    node = pbr.find('m:' + xml_name, NS)
                    if node is not None:
                        preset['pbr'][key] = float(node.text)
                channels = {}
                for xml_name, key in [('metallic_texture', 'metallic'), ('roughness_texture', 'roughness'),
                                      ('normal_texture', 'normal'), ('occlusion_texture', 'ao')]:
                    node = pbr.find('m:' + xml_name, NS)
                    if node is not None:
                        channels[key] = extract(node)
                if channels:
                    preset['pbr']['textures'] = channels
                if 'ao' not in channels:
                    preset['pbr'].pop('ao_strength', None)
                for xml_name, key in [('enable_metalness', 'metalness_enabled'), ('enable_roughness', 'roughness_enabled'),
                                      ('enable_normal', 'normal_enabled'), ('enable_occlusion', 'ao_enabled')]:
                    node = pbr.find('m:' + xml_name, NS)
                    if node is not None:
                        preset['pbr'][key] = node.text == '1'
                normal_style = pbr.find('m:normalMapStyle', NS)
                if normal_style is not None:
                    # Retain the source enum; the caller must translate it using
                    # actual native constants returned by the capability probe.
                    preset['source_normal_style_value'] = int(normal_style.text)
            catalog['presets'][kind] = preset
            catalog['assets'].append({'id': 'native-' + kind, 'name': preset['name'], 'kind': 'material',
                                      'path': str(source), 'source': 'installed SketchUp library',
                                      'license': catalog['license'], 'source_sha256': preset['source_sha256'],
                                      'texture_size_mm': preset.get('texture'), 'native_geometry_verified': False})
    for key, filename in ENVIRONMENTS.items():
        source = resources / 'Environments' / filename
        with ZipFile(source) as archive:
            members = [name for name in archive.namelist() if Path(name).suffix.lower() in ('.hdr', '.exr')]
            if len(members) != 1:
                raise ValueError(f'Expected one environment image in {source}')
            data = archive.read(members[0])
            target = output / 'environments' / (key + Path(members[0]).suffix)
            write(target, data)
            item = {'id': 'native-' + key, 'name': key, 'kind': 'environment', 'path': str(target.resolve()),
                    'source': str(source), 'license': catalog['license'], 'file_sha256': digest(data),
                    'archive_sha256': digest(source.read_bytes())}
            catalog['environments'][key] = item
            catalog['assets'].append(item)
    write(output / 'catalog.json', (json.dumps(catalog, indent=2, ensure_ascii=False) + '\n').encode())
    print(json.dumps({'catalog': str(output / 'catalog.json'), 'materials': len(MATERIALS),
                      'environments': len(ENVIRONMENTS), 'native_applied': False}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--resources', type=Path, default=Path('/Applications/SketchUp 2026/SketchUp.app/Contents/Resources'))
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    prepare(args.resources, args.output_dir.resolve())
