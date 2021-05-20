#!/usr/bin/env vpython
#
# Copyright 2014 The Chromium Authors. All rights reserved.
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.
"""
Utilities for the modular DevTools build.
"""

from __future__ import print_function

import collections
from os import path
import os

try:
    import simplejson as json
except ImportError:
    import json


def read_file(filename):
    with open(path.normpath(filename), 'rt', encoding='utf-8') as input:
        return input.read()


def write_file(filename, content):
    if path.exists(filename):
        os.remove(filename)
    directory = path.dirname(filename)
    if not path.exists(directory):
        os.makedirs(directory)
    with open(filename, 'wt', encoding='utf-8') as output:
        output.write(content)


def bail_error(message):
    raise Exception(message)


def load_and_parse_json(filename):
    try:
        return json.loads(read_file(filename))
    except:
        print('ERROR: Failed to parse %s' % filename)
        raise

class Descriptors:

    def __init__(self, application_name, application_dir,
                 application_descriptor, module_descriptors, extends, worker):
        self.application_name = application_name
        self.application_dir = application_dir
        self.application = application_descriptor
        self._cached_sorted_modules = None
        self.modules = module_descriptors
        self.extends = extends
        self.worker = worker

    def application_json(self):
        result = dict()
        result['modules'] = list(self.application.values())
        return json.dumps(result)

    def module_resources(self, name):
        return [name + '/' + resource for resource in self.modules[name].get('resources', [])]

    def sorted_modules(self):
        if self._cached_sorted_modules:
            return self._cached_sorted_modules

        result = []
        unvisited_modules = set(self.modules)
        temp_modules = set()

        def visit(parent, name):
            if name not in unvisited_modules:
                return None
            if name not in self.modules:
                return (parent, name)
            if name in temp_modules:
                bail_error('Dependency cycle found at module "%s"' % name)
            temp_modules.add(name)
            deps = self.modules[name].get('dependencies')
            if deps:
                for dep_name in deps:
                    bad_dep = visit(name, dep_name)
                    if bad_dep:
                        return bad_dep
            unvisited_modules.remove(name)
            temp_modules.remove(name)
            result.append(name)
            return None

        while len(unvisited_modules):
            for next in unvisited_modules:
                break
            failure = visit(None, next)
            if failure:
                # failure[0] can never be None
                bail_error('Unknown module "%s" encountered in dependencies of "%s"' % (failure[1], failure[0]))

        self._cached_sorted_modules = result
        return result

    def sorted_dependencies_closure(self, module_name):
        visited = set()

        def sorted_deps_for_module(name):
            result = []
            desc = self.modules[name]
            deps = desc.get('dependencies', [])
            for dep in deps:
                result += sorted_deps_for_module(dep)
            if name not in visited:
                result.append(name)
                visited.add(name)
            return result

        return sorted_deps_for_module(module_name)


class DescriptorLoader:

    def __init__(self, application_dir):
        self.application_dir = application_dir

    def load_application(self, application_descriptor_name):
        all_module_descriptors = {}
        result = self._load_application(application_descriptor_name, all_module_descriptors)
        return result

    def load_applications(self, application_descriptor_names):
        all_module_descriptors = {}
        all_application_descriptors = {}
        for application_descriptor_name in application_descriptor_names:
            descriptors = {}
            result = self._load_application(application_descriptor_name, descriptors)
            for name in descriptors:
                all_module_descriptors[name] = descriptors[name]
            for name in result.application:
                all_application_descriptors[name] = result.application[name]
        return Descriptors('all', self.application_dir,
                           all_application_descriptors, all_module_descriptors,
                           None, False)

    def _load_application(self, application_descriptor_name, all_module_descriptors):
        module_descriptors = {}
        application_descriptor_filename = path.join(
            self.application_dir, 'entrypoints', application_descriptor_name,
            application_descriptor_name + '.json')
        descriptor_json = load_and_parse_json(application_descriptor_filename)
        application_descriptor = {desc['name']: desc for desc in descriptor_json['modules']}
        extends = descriptor_json['extends'] if 'extends' in descriptor_json else None
        if extends:
            extends = self._load_application(extends, all_module_descriptors)
        worker = True if 'worker' in descriptor_json and descriptor_json['worker'] else False

        for (module_name, module) in application_descriptor.items():
            if all_module_descriptors.get(module_name):
                bail_error('Duplicate definition of module "%s" in %s' % (module_name, application_descriptor_filename))
            module_descriptors[module_name] = self._read_module_descriptor(module_name, application_descriptor_filename)
            all_module_descriptors[module_name] = module_descriptors[module_name]

        for module in module_descriptors.values():
            for dep in module.get('dependencies', []):
                if dep not in all_module_descriptors:
                    bail_error('Module "%s" (dependency of "%s") not listed in application descriptor %s' %
                               (dep, module['name'], application_descriptor_filename))

        return Descriptors(application_descriptor_name, self.application_dir,
                           application_descriptor, module_descriptors, extends,
                           worker)

    def _read_module_descriptor(self, module_name, application_descriptor_filename):
        json_filename = path.join(self.application_dir, module_name, 'module.json')
        if not path.exists(json_filename):
            bail_error('Module descriptor %s referenced in %s is missing' % (json_filename, application_descriptor_filename))
        module_json = load_and_parse_json(json_filename)
        module_json['name'] = module_name
        return module_json
