require 'json'

package = JSON.parse(File.read(File.join(File.dirname(__FILE__), 'package.json')))

Pod::Spec.new do |s|
  s.name = 'DustCapacitorServe'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = 'https://github.com/rogelioRuiz/dust-serve-capacitor'
  s.author = 'Techxagon'
  s.source = { :git => 'https://github.com/rogelioRuiz/dust-serve-capacitor.git', :tag => s.version.to_s }

  s.source_files = 'ios/Sources/**/*.swift'
  s.ios.deployment_target = '16.0'

  s.dependency 'Capacitor'
  s.dependency 'DustCapacitorCore'
  s.dependency 'DustCore'
  s.dependency 'DustServe'
  s.swift_version = '5.9'
end
