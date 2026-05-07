require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = '3landCapacitorWalletExtension'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = package['homepage']
  s.author = package['author']
  s.source = {
    :git => package['repository']['url'],
    :tag => s.version.to_s
  }
  s.source_files = 'ios/Sources/**/*.{swift,h,m,c,cc,mm,cpp}'
  s.private_header_files = 'ios/Sources/CTweetNacl/include/*.h'
  s.preserve_paths = 'ios/Sources/module.map'
  s.ios.deployment_target = '14.0'
  s.swift_version = '5.9'
  s.dependency 'Capacitor'
  s.xcconfig = {
    'SWIFT_INCLUDE_PATHS' => '$(PODS_TARGET_SRCROOT)/ios/Sources'
  }
end
